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
                await this._startActiveOwnership("active");
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
     * @param {"active" | "candidate"} expectedLifecycleState - State that still owns activation.
     * @returns {Promise<boolean>} - Whether active ownership was established.
     */
    async _startActiveOwnership(expectedLifecycleState) {
        await this.store.reconcileQueueConcurrency();
        if (this.lifecycleState !== expectedLifecycleState)
            return false;
        this._setupDispatchTriggers();
        this._setupStartupHandoffReclaim();
        this._startOrphanSweep();
        await this._startScheduler();
        if (this.lifecycleState !== expectedLifecycleState) {
            if (this.scheduler)
                await this.scheduler.stop();
            this.scheduler = undefined;
            this._clearDispatchTimers();
            this._disconnectBeaconHandlers();
            return false;
        }
        this._activeOwnershipReady = true;
        this._creditReadyWorkers();
        await this._drain();
        return this.lifecycleState === expectedLifecycleState;
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
        const ownershipStarted = await this._startActiveOwnership("candidate");
        if (!ownershipStarted || this.lifecycleState !== "candidate") {
            throw new Error("Background jobs generation retirement started before activation acquired ownership");
        }
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
        const activationInProgress = this.lifecycleState === "candidate" && Boolean(this._activationPromise);
        if (this.lifecycleState !== "active" && !activationInProgress)
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
        if (this._activationPromise)
            await Promise.allSettled([this._activationPromise]);
        if (this.scheduler)
            await this.scheduler.stop();
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9iYWNrZ3JvdW5kLWpvYnMvbWFpbi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFFLFVBQVUsRUFBRSxNQUFNLFFBQVEsQ0FBQTtBQUNuQyxPQUFPLEdBQUcsTUFBTSxLQUFLLENBQUE7QUFDckIsT0FBTyxVQUFVLE1BQU0sa0JBQWtCLENBQUE7QUFDekMsT0FBTyx1QkFBdUIsTUFBTSxnQkFBZ0IsQ0FBQTtBQUNwRCxPQUFPLE1BQU0sTUFBTSxjQUFjLENBQUE7QUFDakMsT0FBTyw4QkFBOEIsTUFBTSwyQ0FBMkMsQ0FBQTtBQUN0RixPQUFPLGNBQWMsTUFBTSx1QkFBdUIsQ0FBQTtBQUNsRCxPQUFPLGlCQUFpQixFQUFFLEVBQUUsZ0JBQWdCLEVBQUUsTUFBTSxnQ0FBZ0MsQ0FBQTtBQUNwRixPQUFPLEVBQUUsb0JBQW9CLEVBQUUsMkJBQTJCLEVBQUUsTUFBTSwwQkFBMEIsQ0FBQTtBQUM1RixPQUFPLG9DQUFvQyxNQUFNLCtCQUErQixDQUFBO0FBRWhGOzs7OztHQUtHO0FBQ0g7Ozs7OztHQU1HO0FBQ0gsTUFBTSxnQkFBZ0IsR0FBRyxvQ0FBb0MsQ0FBQTtBQUU3RDs7OztHQUlHO0FBQ0gsTUFBTSxZQUFZLEdBQUcsYUFBYSxDQUFBLENBQUMsYUFBYTtBQUNoRCwrRUFBK0U7QUFDL0UsTUFBTSx1QkFBdUIsR0FBRyxLQUFLLENBQUE7QUFDckMsc0RBQXNEO0FBQ3RELE1BQU0sd0JBQXdCLEdBQUcsS0FBSyxDQUFBO0FBQ3RDLHlGQUF5RjtBQUN6RixNQUFNLHlCQUF5QixHQUFHLEtBQUssQ0FBQTtBQUN2QyxNQUFNLDRCQUE0QixHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsSUFBSSxDQUFBO0FBQ25ELE1BQU0seUNBQXlDLEdBQUcsMkRBQTJELFlBQVksRUFBRSxDQUFBO0FBRTNIOzs7OztHQUtHO0FBQ0gsU0FBUywrQkFB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QyxvQkFBb0IsQ0FBQTtRQUMzRCwyQkFBMkI7UUFDM0IsTUFBTSxLQUFLLEdBQUcsRUFBRSxDQUFBO1FBRWhCLEtBQUssTUFBTSxNQUFNLElBQUksSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ2xDLDJFQUEyRTtZQUMzRSwwRUFBMEU7WUFDMUUsc0VBQXNFO1lBQ3RFLHVFQUF1RTtZQUN2RSxJQUFJLENBQUMsTUFBTSxDQUFDLGlCQUFpQjtnQkFBRSxTQUFRO1lBRXZDLE1BQU0sVUFBVSxHQUFHLE9BQU8sTUFBTSxDQUFDLFVBQVUsS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQTtZQUVoRixJQUFJLFVBQVUsSUFBSSxNQUFNO2dCQUFFLEtBQUssQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDOUMsQ0FBQztRQUVELEtBQUssTUFBTSxNQUFNLElBQUksS0FBSyxFQUFFLENBQUM7WUFDM0IsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyx1Q0FBdUMsRUFBRSxFQUFDLFFBQVEsRUFBRSxNQUFNLENBQUMsUUFBUSxFQUFFLFVBQVUsRUFBRSxNQUFNLENBQUMsVUFBVSxFQUFDLENBQUMsQ0FBQyxDQUFBO1lBRTdILElBQUksQ0FBQztnQkFDSCxNQUFNLENBQUMsS0FBSyxFQUFFLENBQUE7WUFDaEIsQ0FBQztZQUFDLE1BQU0sQ0FBQztnQkFDUCw0REFBNEQ7WUFDOUQsQ0FBQztZQUVELE1BQU0sSUFBSSxDQUFDLHlCQUF5QixDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBQzlDLENBQUM7SUFDSCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHsgcmFuZG9tVVVJRCB9IGZyb20gXCJjcnlwdG9cIlxuaW1wb3J0IG5ldCBmcm9tIFwibmV0XCJcbmltcG9ydCBKc29uU29ja2V0IGZyb20gXCIuL2pzb24tc29ja2V0LmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9ic1NjaGVkdWxlciBmcm9tIFwiLi9zY2hlZHVsZXIuanNcIlxuaW1wb3J0IExvZ2dlciBmcm9tIFwiLi4vbG9nZ2VyLmpzXCJcbmltcG9ydCBQcnVuZVRlcm1pbmFsQmFja2dyb3VuZEpvYnNKb2IgZnJvbSBcIi4uL2pvYnMvcHJ1bmUtdGVybWluYWwtYmFja2dyb3VuZC1qb2JzLmpzXCJcbmltcG9ydCBWZWxvY2lvdXNFcnJvciBmcm9tIFwiLi4vdmVsb2Npb3VzLWVycm9yLmpzXCJcbmltcG9ydCBzaHV0ZG93bkxpZmVjeWNsZSwgeyBydW5TaHV0ZG93blN0ZXBzIH0gZnJvbSBcIi4uL3V0aWxzL3NodXRkb3duLWxpZmVjeWNsZS5qc1wiXG5pbXBvcnQgeyB2YWxpZGF0ZUdlbmVyYXRpb25JZCwgd29ya2VySWRCZWxvbmdzVG9HZW5lcmF0aW9uIH0gZnJvbSBcIi4vZ2VuZXJhdGlvbi1pZGVudGl0eS5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYnNMaWZlY3ljbGVDb250cm9sU2VydmVyIGZyb20gXCIuL2xpZmVjeWNsZS1jb250cm9sLXNlcnZlci5qc1wiXG5cbi8qKlxuICogV29ya2VyRXhlY3V0aW9uTW9kZUNhcGFiaWxpdHkgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFdvcmtlckV4ZWN1dGlvbk1vZGVDYXBhYmlsaXR5XG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9IGV4ZWN1dGlvbk1vZGUgLSBFeGVjdXRpb24gbW9kZS5cbiAqIEBwcm9wZXJ0eSB7KHdvcmtlcjogSnNvblNvY2tldCkgPT4gYm9vbGVhbn0gYWNjZXB0cyAtIFdoZXRoZXIgdGhlIHdvcmtlciBhY2NlcHRzIHRoaXMgbW9kZS5cbiAqL1xuLyoqXG4gKiBDaGFubmVsIHVzZWQgYnkgYGJhY2tncm91bmQtam9icy1tYWluYCB0byBjb29yZGluYXRlIGRpc3BhdGNoIHdha2UtdXBzXG4gKiBhY3Jvc3MgcHJvY2Vzc2VzIHZpYSBCZWFjb24uIFdvcmtlcnMgZG8gTk9UIHN1YnNjcmliZSB0byB0aGlzIGNoYW5uZWxcbiAqIOKAlCB0aGV5IGFscmVhZHkgcmVjZWl2ZSBqb2ItaGFuZG9mZiBtZXNzYWdlcyBvbiB0aGVpciBKc29uU29ja2V0IHRvXG4gKiBtYWluOyB0aGlzIGNoYW5uZWwgZXhpc3RzIHNvIGNyb3NzLXByb2Nlc3MgZW5xdWV1ZXMgKG9yIGZ1dHVyZVxuICogbXVsdGktbWFpbiBkZXBsb3ltZW50cykgY2FuIHBva2UgYW4gaWRsZSBtYWluIHRvIGRyYWluLlxuICovXG5jb25zdCBESVNQQVRDSF9DSEFOTkVMID0gXCJ2ZWxvY2lvdXMtYmFja2dyb3VuZC1qb2JzLWRpc3BhdGNoXCJcblxuLyoqXG4gKiBgc2V0VGltZW91dGAgaXMgaW1wbGVtZW50ZWQgd2l0aCAzMi1iaXQgc2lnbmVkIGRlbGF5cyBvbiBOb2RlOyBwYXNzaW5nXG4gKiBhbnl0aGluZyBsYXJnZXIgc2lsZW50bHkgY2xhbXBzIHRvIDFtcyBhbmQgZmlyZXMgaW1tZWRpYXRlbHkuIENhcCB0aGVcbiAqIHNjaGVkdWxlZC1qb2IgdGltZXIgaGVyZSBhbmQgcmUtYXJtIHdoZW4gaXQgZXhwaXJlcy5cbiAqL1xuY29uc3QgTUFYX1RJTUVSX01TID0gMl8xNDdfNDgzXzY0NyAvLyB+MjQuOCBkYXlzXG4vKiogQSB3b3JrZXIgc2lsZW50IChubyBoZWFydGJlYXQvcmVhZHkvcmVwb3J0KSBsb25nZXIgdGhhbiB0aGlzIGlzIGRyb3BwZWQuICovXG5jb25zdCBXT1JLRVJfU1RBTEVfVElNRU9VVF9NUyA9IDYwMDAwXG4vKiogSG93IG9mdGVuIHRoZSBtYWluIHNjYW5zIHdvcmtlcnMgZm9yIHN0YWxlbmVzcy4gKi9cbmNvbnN0IFdPUktFUl9MSVZFTkVTU19TV0VFUF9NUyA9IDE1MDAwXG4vKiogR3JhY2UgZm9yIHdvcmtlcnMgZnJvbSB0aGUgcHJldmlvdXMgbWFpbiBnZW5lcmF0aW9uIHRvIHJlY29ubmVjdCBhbmQgYWRvcHQgbGVhc2VzLiAqL1xuY29uc3QgV09SS0VSX1JFQ09OTkVDVF9HUkFDRV9NUyA9IDMwMDAwXG5jb25zdCBHRU5FUkFUSU9OX09SUEhBTkVEX0FGVEVSX01TID0gNjAgKiA2MCAqIDEwMDBcbmNvbnN0IFdPUktFUl9SRUNPTk5FQ1RfR1JBQ0VfVkFMSURBVElPTl9NRVNTQUdFID0gYHdvcmtlclJlY29ubmVjdEdyYWNlTXMgbXVzdCBiZSBhbiBpbnRlZ2VyIGJldHdlZW4gMCBhbmQgJHtNQVhfVElNRVJfTVN9YFxuXG4vKipcbiAqIFJlc29sdmVzIGEgc3RhcnR1cCByZWNvbm5lY3QgZ3JhY2Ugd2l0aG91dCBhbGxvd2luZyBOb2RlJ3MgdGltZXIgb3ZlcmZsb3cgdG9cbiAqIHR1cm4gYW4gaW50ZW50aW9uYWxseSBsb25nIGdyYWNlIGludG8gYW4gaW1tZWRpYXRlIHJlY2xhaW0uXG4gKiBAcGFyYW0ge251bWJlciB8IHVuZGVmaW5lZH0gd29ya2VyUmVjb25uZWN0R3JhY2VNcyAtIFJlcXVlc3RlZCByZWNvbm5lY3QgZ3JhY2UuXG4gKiBAcmV0dXJucyB7bnVtYmVyfSAtIFZhbGlkIHRpbWVyIGRlbGF5LlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVXb3JrZXJSZWNvbm5lY3RHcmFjZU1zKHdvcmtlclJlY29ubmVjdEdyYWNlTXMpIHtcbiAgaWYgKHdvcmtlclJlY29ubmVjdEdyYWNlTXMgPT09IHVuZGVmaW5lZCkgcmV0dXJuIFdPUktFUl9SRUNPTk5FQ1RfR1JBQ0VfTVNcbiAgaWYgKCFOdW1iZXIuaXNJbnRlZ2VyKHdvcmtlclJlY29ubmVjdEdyYWNlTXMpIHx8IHdvcmtlclJlY29ubmVjdEdyYWNlTXMgPCAwIHx8IHdvcmtlclJlY29ubmVjdEdyYWNlTXMgPiBNQVhfVElNRVJfTVMpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFdPUktFUl9SRUNPTk5FQ1RfR1JBQ0VfVkFMSURBVElPTl9NRVNTQUdFKVxuICB9XG5cbiAgcmV0dXJuIHdvcmtlclJlY29ubmVjdEdyYWNlTXNcbn1cbi8qKlxuICogV29ya2VyIGV4ZWN1dGlvbiBtb2RlIGNhcGFiaWxpdGllcy5cbiAqIEB0eXBlIHtXb3JrZXJFeGVjdXRpb25Nb2RlQ2FwYWJpbGl0eVtdfSAqL1xuY29uc3QgV09SS0VSX0VYRUNVVElPTl9NT0RFX0NBUEFCSUxJVElFUyA9IFtcbiAge2V4ZWN1dGlvbk1vZGU6IFwiaW5saW5lXCIsIGFjY2VwdHM6ICh3b3JrZXIpID0+IHdvcmtlci5hY2NlcHRzSW5saW5lSm9icyAhPT0gZmFsc2V9LFxuICB7ZXhlY3V0aW9uTW9kZTogXCJmb3JrZWRcIiwgYWNjZXB0czogKHdvcmtlcikgPT4gd29ya2VyLmFjY2VwdHNGb3JrZWRKb2JzICE9PSBmYWxzZX0sXG4gIC8vIFBvb2xlZCBpcyBvcHQtaW46IG9ubHkgd29ya2VycyB0aGF0IGV4cGxpY2l0bHkgYWR2ZXJ0aXNlIGBhY2NlcHRzUG9vbGVkYFxuICAvLyByZWNlaXZlIHBvb2xlZCBqb2JzLiBUaGUgYD09PSB0cnVlYCAocmF0aGVyIHRoYW4gYCE9PSBmYWxzZWApIGNoZWNrIGtlZXBzIGFcbiAgLy8gcHJlLXBvb2xlZCB3b3JrZXIg4oCUIHdoaWNoIG5ldmVyIHNlbmRzIHRoZSBmaWVsZCDigJQgb3V0IG9mIHRoZSBwb29sZWQtY2FwYWJsZVxuICAvLyBzZXQsIHNvIHRoZSBtYWluIG5ldmVyIGRpc3BhdGNoZXMgYSBwb29sZWQgam9iIHRvIGEgd29ya2VyIHRoYXQgY2Fubm90IHJ1blxuICAvLyBvbmUuIFRoaXMgaXMgdGhlIGNvbnNlcnZhdGl2ZSBoYWxmIG9mIHRoZSBleHRlbmRlZCByZWFkaW5lc3MgcHJvdG9jb2wuXG4gIHtleGVjdXRpb25Nb2RlOiBcInBvb2xlZFwiLCBhY2NlcHRzOiAod29ya2VyKSA9PiB3b3JrZXIuYWNjZXB0c1Bvb2xlZEpvYnMgPT09IHRydWUgJiYgKCF3b3JrZXIudXNlc1Bvb2xlZENhcGFjaXR5Q3JlZGl0cyB8fCB3b3JrZXIuYXZhaWxhYmxlUG9vbGVkU2xvdHMgPiAwKX0sXG4gIHtleGVjdXRpb25Nb2RlOiBcInNwYXduZWRcIiwgYWNjZXB0czogKHdvcmtlcikgPT4gd29ya2VyLmFjY2VwdHNTcGF3bmVkSm9icyAhPT0gZmFsc2V9XG5dXG5jb25zdCBXT1JLRVJfRVhFQ1VUSU9OX01PREVfQ0FQQUJJTElUSUVTX0JZX01PREUgPSBuZXcgTWFwKFxuICBXT1JLRVJfRVhFQ1VUSU9OX01PREVfQ0FQQUJJTElUSUVTLm1hcCgoY2FwYWJpbGl0eSkgPT4gW2NhcGFiaWxpdHkuZXhlY3V0aW9uTW9kZSwgY2FwYWJpbGl0eV0pXG4pXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEJhY2tncm91bmRKb2JzTWFpbiB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuaG9zdF0gLSBIb3N0bmFtZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnBvcnRdIC0gUG9ydC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmdlbmVyYXRpb25JZF0gLSBFeHBsaWNpdCByZWxlYXNlIGdlbmVyYXRpb24gaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25Jbml0aWFsU3RhdGV9IFthcmdzLmluaXRpYWxHZW5lcmF0aW9uU3RhdGVdIC0gRXhwbGljaXQgZ2VuZXJhdGlvbiBib290IHN0YXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MubGlmZWN5Y2xlU29ja2V0UGF0aF0gLSBFeHBsaWNpdCBsaWZlY3ljbGUgc29ja2V0IHBhdGguXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy53b3JrZXJTdGFsZVRpbWVvdXRNc10gLSBPdmVycmlkZSBob3cgbG9uZyBhIHNpbGVudCB3b3JrZXIgbWF5IGdvIGJlZm9yZSBiZWluZyBkcm9wcGVkIChkZWZhdWx0IDYwMDAwbXMpLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3Mud29ya2VyTGl2ZW5lc3NTd2VlcE1zXSAtIE92ZXJyaWRlIGhvdyBvZnRlbiBzdGFsZSB3b3JrZXJzIGFyZSBzd2VwdCBmb3IgKGRlZmF1bHQgMTUwMDBtcykuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy53b3JrZXJSZWNvbm5lY3RHcmFjZU1zXSAtIEludGVnZXIgZnJvbSAwIHRocm91Z2ggMiwxNDcsNDgzLDY0NyBvdmVycmlkaW5nIGhvdyBsb25nIHByZXZpb3VzLWdlbmVyYXRpb24gd29ya2VycyBtYXkgcmVjb25uZWN0IGJlZm9yZSBleGFjdCBzdGFydHVwIGxlYXNlcyBhcmUgcmVjbGFpbWVkIChkZWZhdWx0IDMwMDAwbXMpLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmNsb3NlRGF0YWJhc2VDb25uZWN0aW9uc09uU3RvcF0gLSBXaGV0aGVyIHN0b3Agb3ducyBjbG9zaW5nIHRoZSBjb25maWd1cmF0aW9uJ3MgZGF0YWJhc2UgcG9vbHMgKGRlZmF1bHQgdHJ1ZSkuXG4gICAqIEBwYXJhbSB7KCkgPT4gdm9pZCB8IFByb21pc2U8dm9pZD59IFthcmdzLm9uU3RvcHBlZF0gLSBMaWZlY3ljbGUgaG9vayBpbnZva2VkIGFmdGVyIHRoZSBtYWluIHByb2Nlc3MgZmluaXNoZXMgc3RvcHBpbmcuXG4gICAqIEBwYXJhbSB7KGFyZ3M6IHtoYW5kb2ZmOiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JIYW5kb2ZmLCBqb2I6IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30pID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+fSBbYXJncy5hZnRlckhhbmRvZmZDbGFpbV0gLSBFeHBsaWNpdCBoYW5kb2ZmLWNsYWltIG9ic2VydmF0aW9uIGhvb2suXG4gICAqIEBwYXJhbSB7KHdvcmtlcjogSnNvblNvY2tldCkgPT4gdm9pZH0gW2FyZ3Mub25Xb3JrZXJSZWFkeV0gLSBFeHBsaWNpdCByZWFkaW5lc3Mgb2JzZXJ2YXRpb24gaG9vay5cbiAgICogQHBhcmFtIHsod29ya2VyOiBKc29uU29ja2V0KSA9PiB2b2lkfSBbYXJncy5vbldvcmtlckhlYXJ0YmVhdF0gLSBFeHBsaWNpdCBoZWFydGJlYXQgb2JzZXJ2YXRpb24gaG9vay5cbiAgICogQHBhcmFtIHsod29ya2VySWQ6IHN0cmluZykgPT4gdm9pZH0gW2FyZ3Mub25Xb3JrZXJEaXNjb25uZWN0ZWRdIC0gRXhwbGljaXQgZ2VuZXJhdGlvbiBkaXNjb25uZWN0IG9ic2VydmF0aW9uIGhvb2suXG4gICAqIEBwYXJhbSB7KHdvcmtlcklkOiBzdHJpbmcpID0+IHZvaWR9IFthcmdzLm9uV29ya2VySGFuZG9mZnNSZWxlYXNlZF0gLSBFeHBsaWNpdCBncmFjZS1leHBpcnkgb2JzZXJ2YXRpb24gaG9vay5cbiAgICogQHBhcmFtIHsoam9iczogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93W10pID0+IHZvaWR9IFthcmdzLm9uU3RhcnR1cEhhbmRvZmZzUmVjbGFpbWVkXSAtIEV4cGxpY2l0IHN0YXJ0dXAgcmVjbGFpbSBvYnNlcnZhdGlvbiBob29rLlxuICAgKiBAcGFyYW0geyhhcmdzOiB7YWNjZXB0ZWQ6IGJvb2xlYW4sIGpvYklkOiBzdHJpbmcsIHN0YXR1czogXCJjb21wbGV0ZWRcIiB8IFwiZmFpbGVkXCIgfCBcInJlc2NoZWR1bGVkXCJ9KSA9PiB2b2lkfSBbYXJncy5vbkpvYlVwZGF0ZWRdIC0gRXhwbGljaXQgZHVyYWJsZSByZXBvcnQgb2JzZXJ2YXRpb24gaG9vay5cbiAgICogQHBhcmFtIHt7bm93OiAoKSA9PiBudW1iZXIsIHNldFRpbWVvdXQ/OiAoY2FsbGJhY2s6ICgpID0+IHZvaWQsIGRlbGF5TXM6IG51bWJlcikgPT4gUmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudW1iZXIsIGNsZWFyVGltZW91dD86ICh0aW1lcklkOiBSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bWJlcikgPT4gdm9pZH19IFthcmdzLmNsb2NrXSAtIEluamVjdGFibGUgd2FsbCBjbG9jayBmb3IgZGV0ZXJtaW5pc3RpYyBsaWZlY3ljbGUgdGVzdHMuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgaG9zdCwgcG9ydCwgZ2VuZXJhdGlvbklkOiBleHBsaWNpdEdlbmVyYXRpb25JZCwgaW5pdGlhbEdlbmVyYXRpb25TdGF0ZTogZXhwbGljaXRJbml0aWFsR2VuZXJhdGlvblN0YXRlLCBsaWZlY3ljbGVTb2NrZXRQYXRoOiBleHBsaWNpdExpZmVjeWNsZVNvY2tldFBhdGgsIHdvcmtlclN0YWxlVGltZW91dE1zLCB3b3JrZXJMaXZlbmVzc1N3ZWVwTXMsIHdvcmtlclJlY29ubmVjdEdyYWNlTXMsIGNsb3NlRGF0YWJhc2VDb25uZWN0aW9uc09uU3RvcCA9IHRydWUsIG9uU3RvcHBlZCwgYWZ0ZXJIYW5kb2ZmQ2xhaW0sIG9uV29ya2VyUmVhZHksIG9uV29ya2VySGVhcnRiZWF0LCBvbldvcmtlckRpc2Nvbm5lY3RlZCwgb25Xb3JrZXJIYW5kb2Zmc1JlbGVhc2VkLCBvblN0YXJ0dXBIYW5kb2Zmc1JlY2xhaW1lZCwgb25Kb2JVcGRhdGVkLCBjbG9ja30pIHtcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3AgPSBjbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3BcbiAgICB0aGlzLm9uU3RvcHBlZCA9IG9uU3RvcHBlZFxuICAgIHRoaXMuYWZ0ZXJIYW5kb2ZmQ2xhaW0gPSBhZnRlckhhbmRvZmZDbGFpbVxuICAgIHRoaXMub25Xb3JrZXJSZWFkeSA9IG9uV29ya2VyUmVhZHlcbiAgICB0aGlzLm9uV29ya2VySGVhcnRiZWF0ID0gb25Xb3JrZXJIZWFydGJlYXRcbiAgICB0aGlzLm9uV29ya2VyRGlzY29ubmVjdGVkID0gb25Xb3JrZXJEaXNjb25uZWN0ZWRcbiAgICB0aGlzLm9uV29ya2VySGFuZG9mZnNSZWxlYXNlZCA9IG9uV29ya2VySGFuZG9mZnNSZWxlYXNlZFxuICAgIHRoaXMub25TdGFydHVwSGFuZG9mZnNSZWNsYWltZWQgPSBvblN0YXJ0dXBIYW5kb2Zmc1JlY2xhaW1lZFxuICAgIHRoaXMub25Kb2JVcGRhdGVkID0gb25Kb2JVcGRhdGVkXG4gICAgdGhpcy5jbG9jayA9IHtcbiAgICAgIGNsZWFyVGltZW91dDogY2xvY2s/LmNsZWFyVGltZW91dCB8fCAoKHRpbWVySWQpID0+IGNsZWFyVGltZW91dCh0aW1lcklkKSksXG4gICAgICBub3c6IGNsb2NrPy5ub3cgfHwgKCgpID0+IERhdGUubm93KCkpLFxuICAgICAgc2V0VGltZW91dDogY2xvY2s/LnNldFRpbWVvdXQgfHwgKChjYWxsYmFjaywgZGVsYXlNcykgPT4gc2V0VGltZW91dChjYWxsYmFjaywgZGVsYXlNcykpXG4gICAgfVxuICAgIGNvbnN0IGNvbmZpZyA9IGNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKVxuICAgIGNvbnN0IGdlbmVyYXRpb25Db25maWcgPSBjb25maWd1cmF0aW9uLnJlc29sdmVCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25Db25maWcoe1xuICAgICAgZ2VuZXJhdGlvbklkOiBleHBsaWNpdEdlbmVyYXRpb25JZCxcbiAgICAgIGluaXRpYWxHZW5lcmF0aW9uU3RhdGU6IGV4cGxpY2l0SW5pdGlhbEdlbmVyYXRpb25TdGF0ZSxcbiAgICAgIGxpZmVjeWNsZVNvY2tldFBhdGg6IGV4cGxpY2l0TGlmZWN5Y2xlU29ja2V0UGF0aCxcbiAgICAgIHNvdXJjZU5hbWU6IFwiQmFja2dyb3VuZEpvYnNNYWluXCJcbiAgICB9KVxuICAgIHRoaXMuZ2VuZXJhdGlvbklkID0gZ2VuZXJhdGlvbkNvbmZpZy5nZW5lcmF0aW9uSWRcbiAgICB0aGlzLmluaXRpYWxHZW5lcmF0aW9uU3RhdGUgPSBnZW5lcmF0aW9uQ29uZmlnLmluaXRpYWxHZW5lcmF0aW9uU3RhdGVcbiAgICB0aGlzLmxpZmVjeWNsZVNvY2tldFBhdGggPSBnZW5lcmF0aW9uQ29uZmlnLmxpZmVjeWNsZVNvY2tldFBhdGhcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uTGlmZWN5Y2xlU3RhdGV9ICovXG4gICAgdGhpcy5saWZlY3ljbGVTdGF0ZSA9IFwic3RhcnRpbmdcIlxuICAgIHRoaXMuX2FjdGl2ZU93bmVyc2hpcFJlYWR5ID0gZmFsc2VcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fYWN0aXZhdGlvblByb21pc2UgPSB1bmRlZmluZWRcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fcmV0aXJlbWVudFByb21pc2UgPSB1bmRlZmluZWRcbiAgICAvKiogQHR5cGUge1NldDxKc29uU29ja2V0Pn0gKi9cbiAgICB0aGlzLmNhbmRpZGF0ZVJlYWR5V29ya2VycyA9IG5ldyBTZXQoKVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywge3dvcmtlcjogSnNvblNvY2tldCwgdGltZXI6IFJldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVtYmVyfT59ICovXG4gICAgdGhpcy5kaXNjb25uZWN0ZWRXb3JrZXJzID0gbmV3IE1hcCgpXG4gICAgdGhpcy5fbGlmZWN5Y2xlUmVxdWVzdExlYXNlcyA9IDBcbiAgICB0aGlzLl9hY3RpdmVOb25Xb3JrZXJSZXF1ZXN0cyA9IDBcbiAgICAvKipcbiAgICAgKiBSZXNvbHZlcyBzdG9wIG9ic2VydmF0aW9uLlxuICAgICAqIEB0eXBlIHsoKSA9PiB2b2lkfVxuICAgICAqL1xuICAgIHRoaXMuX3Jlc29sdmVTdG9wcGVkID0gKCkgPT4ge31cbiAgICB0aGlzLl9zdG9wcGVkUHJvbWlzZSA9IG5ldyBQcm9taXNlKCgvKiogQHR5cGUgeyh2YWx1ZTogdm9pZCkgPT4gdm9pZH0gKi8gcmVzb2x2ZSkgPT4geyB0aGlzLl9yZXNvbHZlU3RvcHBlZCA9IHJlc29sdmUgfSlcbiAgICB0aGlzLmhvc3QgPSBob3N0IHx8IGNvbmZpZy5ob3N0XG4gICAgdGhpcy5wb3J0ID0gdHlwZW9mIHBvcnQgPT09IFwibnVtYmVyXCIgPyBwb3J0IDogY29uZmlnLnBvcnRcbiAgICB0aGlzLmRpc3BhdGNoU3RyYXRlZ3kgPSBjb25maWcuZGlzcGF0Y2hTdHJhdGVneVxuICAgIHRoaXMucG9sbEludGVydmFsTXMgPSBjb25maWcucG9sbEludGVydmFsTXNcbiAgICB0aGlzLnJldGVudGlvbiA9IGNvbmZpZy5yZXRlbnRpb25cbiAgICAvLyBBIHdvcmtlciB0aGF0IHN0b3BzIHNlbmRpbmcgYW55dGhpbmcgKGhlYXJ0YmVhdC9yZWFkeS9yZXBvcnQpIGZvciB0aGlzXG4gICAgLy8gbG9uZyBpcyB0cmVhdGVkIGFzIHdlZGdlZC9kZWFkOiBpdHMgbGVhc2VzIGFyZSByZWxlYXNlZCBhbmQgaXQgaXMgZHJvcHBlZC5cbiAgICB0aGlzLndvcmtlclN0YWxlVGltZW91dE1zID0gdHlwZW9mIHdvcmtlclN0YWxlVGltZW91dE1zID09PSBcIm51bWJlclwiICYmIHdvcmtlclN0YWxlVGltZW91dE1zID49IDEgPyB3b3JrZXJTdGFsZVRpbWVvdXRNcyA6IFdPUktFUl9TVEFMRV9USU1FT1VUX01TXG4gICAgdGhpcy53b3JrZXJMaXZlbmVzc1N3ZWVwTXMgPSB0eXBlb2Ygd29ya2VyTGl2ZW5lc3NTd2VlcE1zID09PSBcIm51bWJlclwiICYmIHdvcmtlckxpdmVuZXNzU3dlZXBNcyA+PSAxID8gd29ya2VyTGl2ZW5lc3NTd2VlcE1zIDogV09SS0VSX0xJVkVORVNTX1NXRUVQX01TXG4gICAgdGhpcy53b3JrZXJSZWNvbm5lY3RHcmFjZU1zID0gbm9ybWFsaXplV29ya2VyUmVjb25uZWN0R3JhY2VNcyh3b3JrZXJSZWNvbm5lY3RHcmFjZU1zKVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9hZGFwdGVyLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5hZGFwdGVyID0gdW5kZWZpbmVkXG4gICAgdGhpcy5sb2dnZXIgPSBuZXcgTG9nZ2VyKHRoaXMpXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtTZXQ8SnNvblNvY2tldD59ICovXG4gICAgdGhpcy53b3JrZXJzID0gbmV3IFNldCgpXG4gICAgLyoqIEB0eXBlIHtTZXQ8SnNvblNvY2tldD59ICovXG4gICAgdGhpcy5jb25uZWN0aW9ucyA9IG5ldyBTZXQoKVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7U2V0PEpzb25Tb2NrZXQ+fSAqL1xuICAgIHRoaXMucmVhZHlXb3JrZXJzID0gbmV3IFNldCgpXG4gICAgLyoqXG4gICAgICogQWN0aXZlIGR1cmFibGUgaGFuZG9mZnMga2V5ZWQgYnkgdGhlIGV4YWN0IHdvcmtlciBzb2NrZXQgdGhhdCByZWNlaXZlZCB0aGVtLlxuICAgICAqIEB0eXBlIHtNYXA8SnNvblNvY2tldCwgTWFwPHN0cmluZywgc3RyaW5nPj59ICovXG4gICAgdGhpcy53b3JrZXJIYW5kb2ZmcyA9IG5ldyBNYXAoKVxuICAgIC8qKlxuICAgICAqIEV4YWN0IGNhbGxlci1nZW5lcmF0ZWQgbGVhc2VzIHdob3NlIGNsYWltIG91dGNvbWUgd2FzIGFtYmlndW91cyBvciB3aG9zZVxuICAgICAqIHByZS1kaXNwYXRjaCByZWxlYXNlIGhhcyBub3QgeWV0IGJlZW4gYWNrbm93bGVkZ2VkLiBSZXRhaW5lZCB1bnRpbCBhXG4gICAgICogZmVuY2VkIHJldHVybiBzdWNjZWVkcyAoaW5jbHVkaW5nIGFuIGV4YWN0IG5vLW9wKS5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywgc3RyaW5nPn0gKi9cbiAgICB0aGlzLnBlbmRpbmdIYW5kb2ZmUmVjb3ZlcmllcyA9IG5ldyBNYXAoKVxuICAgIC8qKlxuICAgICAqIEhhbmRvZmYtYWRvcHRpb24gcXVlcmllcyBzdGFydGVkIGJ5IHdvcmtlciBoZWxsbyBtZXNzYWdlcy4gU2h1dGRvd24gbXVzdFxuICAgICAqIHdhaXQgZm9yIHRoZXNlIGJlZm9yZSBjbG9zaW5nIHRoZSBjb25maWd1cmF0aW9uJ3MgZGF0YWJhc2UgcG9vbHMuXG4gICAgICogQHR5cGUge1NldDxQcm9taXNlPHZvaWQ+Pn0gKi9cbiAgICB0aGlzLmluZmxpZ2h0V29ya2VySGFuZG9mZkFkb3B0aW9ucyA9IG5ldyBTZXQoKVxuICAgIC8qKlxuICAgICAqIFdvcmtlciBpZHMgd2hvc2UgaGFuZG9mZnMgd2VyZSBzdWNjZXNzZnVsbHkgYWRvcHRlZCBieSBhIHN0aWxsLWxpdmVcbiAgICAgKiBjb25uZWN0aW9uIGluIHRoaXMgbWFpbiBnZW5lcmF0aW9uLlxuICAgICAqIEB0eXBlIHtTZXQ8c3RyaW5nPn1cbiAgICAgKi9cbiAgICB0aGlzLnJlY29ubmVjdGVkV29ya2VySWRzID0gbmV3IFNldCgpXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JIYW5kb2ZmU25hcHNob3RbXX0gKi9cbiAgICB0aGlzLnN0YXJ0dXBIYW5kb2ZmU25hcHNob3QgPSBbXVxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPltdfSAqL1xuICAgIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmQWRvcHRpb25zQXREZWFkbGluZSA9IFtdXG4gICAgdGhpcy5fc3RhcnR1cEhhbmRvZmZHcmFjZUVsYXBzZWQgPSBmYWxzZVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7bmV0LlNlcnZlciB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLnNlcnZlciA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fcG9sbFRpbWVyID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9zY2hlZHVsZWRUaW1lciA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fZXJyb3JSZXRyeVRpbWVyID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9vcnBoYW5UaW1lciA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0SW50ZXJ2YWw+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX3dvcmtlclN0YWxlVGltZXIgPSB1bmRlZmluZWRcbiAgICAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVtYmVyIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVRpbWVyID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVByb21pc2UgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge0JhY2tncm91bmRKb2JzU2NoZWR1bGVyIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuc2NoZWR1bGVyID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fZHJhaW5pbmcgPSBmYWxzZVxuICAgIHRoaXMuX3JlZHJhaW5RdWV1ZWQgPSBmYWxzZVxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9kcmFpblByb21pc2UgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9zdG9wcGVkID0gZmFsc2VcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5zdG9wUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7KCgpID0+IHZvaWQpIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX3Vuc3Vic2NyaWJlQmVhY29uID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHsoKC4uLmFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gdm9pZCkgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fYmVhY29uQ29ubmVjdEhhbmRsZXIgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge2ltcG9ydChcIi4uL2JlYWNvbi9jbGllbnQuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4uL2JlYWNvbi9pbi1wcm9jZXNzLWNsaWVudC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2JlYWNvbkNsaWVudCA9IHVuZGVmaW5lZFxuICAgIC8qKiBAdHlwZSB7QmFja2dyb3VuZEpvYnNMaWZlY3ljbGVDb250cm9sU2VydmVyIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMubGlmZWN5Y2xlQ29udHJvbFNlcnZlciA9IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIENvbXBhdGliaWxpdHkgYWxpYXMgZm9yIGludGVncmF0aW9ucyB0aGF0IGluc3BlY3QgdGhlIGFjdGl2ZSBtYWluIHN0b3JlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9hZGFwdGVyLmpzXCIpLmRlZmF1bHR9IC0gQWRhcHRlciBhY3F1aXJlZCBieSBzdGFydC5cbiAgICovXG4gIGdldCBzdG9yZSgpIHtcbiAgICBpZiAoIXRoaXMuYWRhcHRlcikgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIG1haW4gaGFzIG5vdCBhY3F1aXJlZCBpdHMgYWRhcHRlclwiKVxuXG4gICAgcmV0dXJuIHRoaXMuYWRhcHRlclxuICB9XG5cbiAgLyoqXG4gICAqIFByZXNlcnZlcyB0aGUgaGlzdG9yaWNhbCBzdWJjbGFzcyBzZWFtIHdoaWxlIGtlZXBpbmcgb25lIGFkYXB0ZXIgcmVmZXJlbmNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vYWRhcHRlci5qc1wiKS5kZWZhdWx0fSBhZGFwdGVyIC0gQWRhcHRlciB0byBhc3NpZ24uXG4gICAqL1xuICBzZXQgc3RvcmUoYWRhcHRlcikge1xuICAgIHRoaXMuYWRhcHRlciA9IGFkYXB0ZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0YXJ0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGxpc3RlbmluZy5cbiAgICovXG4gIGFzeW5jIHN0YXJ0KCkge1xuICAgIHRoaXMuX3N0b3BwZWQgPSBmYWxzZVxuICAgIHRoaXMuc3RvcFByb21pc2UgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9hY3RpdmVPd25lcnNoaXBSZWFkeSA9IGZhbHNlXG4gICAgdGhpcy5saWZlY3ljbGVTdGF0ZSA9IFwic3RhcnRpbmdcIlxuICAgIHRoaXMuX3N0b3BwZWRQcm9taXNlID0gbmV3IFByb21pc2UoKC8qKiBAdHlwZSB7KHZhbHVlOiB2b2lkKSA9PiB2b2lkfSAqLyByZXNvbHZlKSA9PiB7IHRoaXMuX3Jlc29sdmVTdG9wcGVkID0gcmVzb2x2ZSB9KVxuICAgIHRoaXMucmVjb25uZWN0ZWRXb3JrZXJJZHMuY2xlYXIoKVxuICAgIHRoaXMuc3RhcnR1cEhhbmRvZmZTbmFwc2hvdCA9IFtdXG4gICAgdGhpcy5fc3RhcnR1cEhhbmRvZmZBZG9wdGlvbnNBdERlYWRsaW5lID0gW11cbiAgICB0aGlzLl9zdGFydHVwSGFuZG9mZkdyYWNlRWxhcHNlZCA9IGZhbHNlXG4gICAgdGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIHRoaXMuY29uZmlndXJhdGlvbi5zZXRDdXJyZW50KClcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uaW5pdGlhbGl6ZSh7dHlwZTogXCJiYWNrZ3JvdW5kLWpvYnMtbWFpblwifSlcbiAgICAgIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5jb25uZWN0QmVhY29uKHtwZWVyVHlwZTogXCJiYWNrZ3JvdW5kLWpvYnMtbWFpblwifSlcblxuICAgICAgaWYgKCF0aGlzLmFkYXB0ZXIpIHtcbiAgICAgICAgdGhpcy5hZGFwdGVyID0gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmFjcXVpcmVSZWFkeUJhY2tncm91bmRKb2JzQWRhcHRlcigpXG4gICAgICB9XG4gICAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQgJiYgIXRoaXMuYWRhcHRlci5zdXBwb3J0c1JlbGVhc2VTY29wZWRHZW5lcmF0aW9ucygpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlRoZSBjb25maWd1cmVkIGJhY2tncm91bmQgam9icyBhZGFwdGVyIGRvZXMgbm90IHN1cHBvcnQgcmVsZWFzZS1zY29wZWQgZ2VuZXJhdGlvbnNcIilcbiAgICAgIH1cblxuICAgICAgaWYgKCF0aGlzLmdlbmVyYXRpb25JZCB8fCB0aGlzLmluaXRpYWxHZW5lcmF0aW9uU3RhdGUgIT09IFwiY2FuZGlkYXRlXCIpIHtcbiAgICAgICAgdGhpcy5zdGFydHVwSGFuZG9mZlNuYXBzaG90ID0gYXdhaXQgdGhpcy5fZ2VuZXJhdGlvbk93bmVkSGFuZG9mZlNuYXBzaG90KClcbiAgICAgIH1cbiAgICAgIGNvbnN0IHNlcnZlciA9IG5ldC5jcmVhdGVTZXJ2ZXIoKHNvY2tldCkgPT4gdGhpcy5faGFuZGxlQ29ubmVjdGlvbihzb2NrZXQpKVxuICAgICAgdGhpcy5zZXJ2ZXIgPSBzZXJ2ZXJcblxuICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBzZXJ2ZXIub25jZShcImVycm9yXCIsIHJlamVjdClcbiAgICAgICAgc2VydmVyLmxpc3Rlbih0aGlzLnBvcnQsIHRoaXMuaG9zdCwgKCkgPT4gcmVzb2x2ZSh1bmRlZmluZWQpKVxuICAgICAgfSlcblxuICAgICAgY29uc3QgYWRkcmVzcyA9IHNlcnZlci5hZGRyZXNzKClcbiAgICAgIGlmIChhZGRyZXNzICYmIHR5cGVvZiBhZGRyZXNzID09PSBcIm9iamVjdFwiKSB7XG4gICAgICAgIHRoaXMucG9ydCA9IGFkZHJlc3MucG9ydFxuICAgICAgfVxuXG4gICAgICB0aGlzLmxpZmVjeWNsZVN0YXRlID0gdGhpcy5nZW5lcmF0aW9uSWQgPyB0aGlzLmluaXRpYWxHZW5lcmF0aW9uU3RhdGUgOiBcImFjdGl2ZVwiXG5cbiAgICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCAmJiB0aGlzLmxpZmVjeWNsZVNvY2tldFBhdGgpIHtcbiAgICAgICAgdGhpcy5saWZlY3ljbGVDb250cm9sU2VydmVyID0gbmV3IEJhY2tncm91bmRKb2JzTGlmZWN5Y2xlQ29udHJvbFNlcnZlcih7XG4gICAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgICAgIGdlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWQsXG4gICAgICAgICAgbWFpbjogdGhpcyxcbiAgICAgICAgICBzb2NrZXRQYXRoOiB0aGlzLmxpZmVjeWNsZVNvY2tldFBhdGhcbiAgICAgICAgfSlcbiAgICAgICAgYXdhaXQgdGhpcy5saWZlY3ljbGVDb250cm9sU2VydmVyLnN0YXJ0KClcbiAgICAgIH1cblxuICAgICAgdGhpcy5fd29ya2VyU3RhbGVUaW1lciA9IHNldEludGVydmFsKCgpID0+IHtcbiAgICAgICAgdm9pZCB0aGlzLl9zd2VlcFN0YWxlV29ya2VycygpXG4gICAgICB9LCB0aGlzLndvcmtlckxpdmVuZXNzU3dlZXBNcylcblxuICAgICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwiYWN0aXZlXCIpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fc3RhcnRBY3RpdmVPd25lcnNoaXAoXCJhY3RpdmVcIilcbiAgICAgIH0gZWxzZSBpZiAodGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJyZXRpcmVkXCIpIHtcbiAgICAgICAgdGhpcy5fc3RhcnRHZW5lcmF0aW9uUmVjb3ZlcnlPd25lcnNoaXAoKVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBsZXQgY2xlYW51cEVycm9yXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuc3RvcCgpXG4gICAgICB9IGNhdGNoIChjYXVnaHRDbGVhbnVwRXJyb3IpIHtcbiAgICAgICAgY2xlYW51cEVycm9yID0gY2F1Z2h0Q2xlYW51cEVycm9yXG4gICAgICB9XG5cbiAgICAgIGlmIChjbGVhbnVwRXJyb3IpIHtcbiAgICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKFxuICAgICAgICAgIFtlcnJvciwgY2xlYW51cEVycm9yXSxcbiAgICAgICAgICBcIkJhY2tncm91bmQgam9icyBtYWluIHN0YXJ0dXAgYW5kIGNsZWFudXAgZmFpbGVkXCIsXG4gICAgICAgICAge2NhdXNlOiBlcnJvcn1cbiAgICAgICAgKVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0b3AuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY2xvc2VkLlxuICAgKi9cbiAgc3RvcCgpIHtcbiAgICBpZiAoIXRoaXMuc3RvcFByb21pc2UpIHRoaXMuc3RvcFByb21pc2UgPSB0aGlzLl9zdG9wKClcblxuICAgIHJldHVybiB0aGlzLnN0b3BQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0aGUgbWFpbi1wcm9jZXNzIHNodXRkb3duIGxpZmVjeWNsZSBvbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNsb3NlZC5cbiAgICovXG4gIGFzeW5jIF9zdG9wKCkge1xuICAgIHRoaXMuX3N0b3BwZWQgPSB0cnVlXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgc2h1dGRvd25MaWZlY3ljbGUoe1xuICAgICAgICBvblN0b3BwZWQ6IHRoaXMub25TdG9wcGVkLFxuICAgICAgICBzaHV0ZG93bjogYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIHRoaXMuX2Nsb3NlV29ya2VycygpXG4gICAgICAgICAgdGhpcy5fY2xlYXJUaW1lcnMoKVxuICAgICAgICAgIHRoaXMuX2Rpc2Nvbm5lY3RCZWFjb25IYW5kbGVycygpXG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuc2NoZWR1bGVyPy5zdG9wKClcbiAgICAgICAgICAgIGlmICh0aGlzLl9kcmFpblByb21pc2UpIGF3YWl0IHRoaXMuX2RyYWluUHJvbWlzZVxuICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICBhd2FpdCB0aGlzLl9kcmFpbldvcmtlckhhbmRvZmZBZG9wdGlvbnMoKVxuICAgICAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLl9kcmFpblN0YXJ0dXBIYW5kb2ZmUmVjbGFpbSgpXG4gICAgICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5fc3RvcEJlYWNvbkFuZFNlcnZlcigpXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuYWRhcHRlciA9IHVuZGVmaW5lZFxuICAgICAgdGhpcy5saWZlY3ljbGVTdGF0ZSA9IFwic3RvcHBlZFwiXG4gICAgICB0aGlzLl9yZXNvbHZlU3RvcHBlZCgpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xvc2Ugd29ya2Vycy5cbiAgICogQHJldHVybnMge3ZvaWR9ICovXG4gIF9jbG9zZVdvcmtlcnMoKSB7XG4gICAgZm9yIChjb25zdCBjb25uZWN0aW9uIG9mIHRoaXMuY29ubmVjdGlvbnMpIHtcbiAgICAgIGNvbm5lY3Rpb24uY2xvc2UoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsZWFyIHRpbWVycy5cbiAgICogQHJldHVybnMge3ZvaWR9ICovXG4gIF9jbGVhclRpbWVycygpIHtcbiAgICBpZiAodGhpcy5fcG9sbFRpbWVyKSBjbGVhckludGVydmFsKHRoaXMuX3BvbGxUaW1lcilcbiAgICBpZiAodGhpcy5fc2NoZWR1bGVkVGltZXIpIGNsZWFyVGltZW91dCh0aGlzLl9zY2hlZHVsZWRUaW1lcilcbiAgICBpZiAodGhpcy5fZXJyb3JSZXRyeVRpbWVyKSBjbGVhclRpbWVvdXQodGhpcy5fZXJyb3JSZXRyeVRpbWVyKVxuICAgIGlmICh0aGlzLl9vcnBoYW5UaW1lcikgY2xlYXJJbnRlcnZhbCh0aGlzLl9vcnBoYW5UaW1lcilcbiAgICBpZiAodGhpcy5fd29ya2VyU3RhbGVUaW1lcikgY2xlYXJJbnRlcnZhbCh0aGlzLl93b3JrZXJTdGFsZVRpbWVyKVxuICAgIGlmICh0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1UaW1lcikgdGhpcy5jbG9jay5jbGVhclRpbWVvdXQodGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltVGltZXIpXG4gICAgZm9yIChjb25zdCB7dGltZXJ9IG9mIHRoaXMuZGlzY29ubmVjdGVkV29ya2Vycy52YWx1ZXMoKSkgdGhpcy5jbG9jay5jbGVhclRpbWVvdXQodGltZXIpXG4gICAgdGhpcy5kaXNjb25uZWN0ZWRXb3JrZXJzLmNsZWFyKClcbiAgICB0aGlzLl9wb2xsVGltZXIgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9zY2hlZHVsZWRUaW1lciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2Vycm9yUmV0cnlUaW1lciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX29ycGhhblRpbWVyID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fd29ya2VyU3RhbGVUaW1lciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVRpbWVyID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkaXNjb25uZWN0IGJlYWNvbiBoYW5kbGVycy5cbiAgICogQHJldHVybnMge3ZvaWR9ICovXG4gIF9kaXNjb25uZWN0QmVhY29uSGFuZGxlcnMoKSB7XG4gICAgaWYgKHRoaXMuX3Vuc3Vic2NyaWJlQmVhY29uKSB7XG4gICAgICB0aGlzLl91bnN1YnNjcmliZUJlYWNvbigpXG4gICAgICB0aGlzLl91bnN1YnNjcmliZUJlYWNvbiA9IHVuZGVmaW5lZFxuICAgIH1cblxuICAgIGlmICh0aGlzLl9iZWFjb25DbGllbnQgJiYgdGhpcy5fYmVhY29uQ29ubmVjdEhhbmRsZXIpIHtcbiAgICAgIHRoaXMuX2JlYWNvbkNsaWVudC5vZmYoXCJjb25uZWN0XCIsIHRoaXMuX2JlYWNvbkNvbm5lY3RIYW5kbGVyKVxuICAgIH1cbiAgICB0aGlzLl9iZWFjb25Db25uZWN0SGFuZGxlciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2JlYWNvbkNsaWVudCA9IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RvcCBiZWFjb24gYW5kIHNlcnZlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59ICovXG4gIGFzeW5jIF9zdG9wQmVhY29uQW5kU2VydmVyKCkge1xuICAgIGF3YWl0IHJ1blNodXRkb3duU3RlcHMoe1xuICAgICAgbWVzc2FnZTogXCJCYWNrZ3JvdW5kIGpvYnMgbWFpbiBhcHBsaWNhdGlvbiBhbmQgZnJhbWV3b3JrIHNodXRkb3duIGZhaWxlZFwiLFxuICAgICAgc3RlcHM6IFtcbiAgICAgICAgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmxpZmVjeWNsZUNvbnRyb2xTZXJ2ZXI/LmNsb3NlKClcbiAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgdGhpcy5saWZlY3ljbGVDb250cm9sU2VydmVyID0gdW5kZWZpbmVkXG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICAuLi4odGhpcy5jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3BcbiAgICAgICAgICA/IFthc3luYyAoKSA9PiBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uc2h1dGRvd24oKV1cbiAgICAgICAgICA6IFtdKSxcbiAgICAgICAgYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmRpc2Nvbm5lY3RCZWFjb24oKSxcbiAgICAgICAgYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5fY2xvc2VTZXJ2ZXIoKSxcbiAgICAgICAgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGlmICh0aGlzLmNsb3NlRGF0YWJhc2VDb25uZWN0aW9uc09uU3RvcCkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmNsb3NlRGF0YWJhc2VDb25uZWN0aW9ucygpXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5jbG9zZUJhY2tncm91bmRKb2JzQWRhcHRlcigpXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICBdXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsb3NlIHNlcnZlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59ICovXG4gIGFzeW5jIF9jbG9zZVNlcnZlcigpIHtcbiAgICBpZiAoIXRoaXMuc2VydmVyKSByZXR1cm5cblxuICAgIGNvbnN0IHtzZXJ2ZXJ9ID0gdGhpc1xuICAgIHRoaXMuc2VydmVyID0gdW5kZWZpbmVkXG4gICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHNlcnZlci5jbG9zZSgoKSA9PiByZXNvbHZlKHVuZGVmaW5lZCkpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHBvcnQuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gQm91bmQgcG9ydC5cbiAgICovXG4gIGdldFBvcnQoKSB7XG4gICAgcmV0dXJuIHRoaXMucG9ydFxuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgdGhlIGxpZmVjeWNsZSBzdGF0ZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uTGlmZWN5Y2xlU3RhdGV9IC0gQ3VycmVudCBsaWZlY3ljbGUgc3RhdGUuXG4gICAqL1xuICBnZXRMaWZlY3ljbGVTdGF0ZSgpIHsgcmV0dXJuIHRoaXMubGlmZWN5Y2xlU3RhdGUgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGEgcHJvbWlzZSB0aGF0IHNldHRsZXMgb25seSBhZnRlciB0aGUgbWFpbiBoYXMgZnVsbHkgc3RvcHBlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gU3RvcCBjb21wbGV0aW9uLlxuICAgKi9cbiAgYXN5bmMgd2FpdFVudGlsU3RvcHBlZCgpIHsgYXdhaXQgdGhpcy5fc3RvcHBlZFByb21pc2UgfVxuXG4gIC8qKlxuICAgKiBTbmFwc2hvdHMgb25seSBleGFjdCBkdXJhYmxlIG93bmVycyBmcm9tIHRoaXMgcmVsZWFzZSBnZW5lcmF0aW9uLlxuICAgKiBMZWdhY3kgbW9kZSBpbnRlbnRpb25hbGx5IHJldGFpbnMgaXRzIGhpc3RvcmljYWwgZ2xvYmFsIHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JIYW5kb2ZmU25hcHNob3RbXT59IC0gT3duZWQgc25hcHNob3QuXG4gICAqL1xuICBhc3luYyBfZ2VuZXJhdGlvbk93bmVkSGFuZG9mZlNuYXBzaG90KCkge1xuICAgIGNvbnN0IGhhbmRvZmZzID0gYXdhaXQgdGhpcy5zdG9yZS5zbmFwc2hvdEhhbmRlZE9mZkpvYnMoKVxuXG4gICAgaWYgKCF0aGlzLmdlbmVyYXRpb25JZCkgcmV0dXJuIGhhbmRvZmZzXG4gICAgY29uc3QgZ2VuZXJhdGlvbklkID0gdGhpcy5nZW5lcmF0aW9uSWRcblxuICAgIHJldHVybiBoYW5kb2Zmcy5maWx0ZXIoKHt3b3JrZXJJZH0pID0+IHdvcmtlcklkQmVsb25nc1RvR2VuZXJhdGlvbih7Z2VuZXJhdGlvbklkLCB3b3JrZXJJZH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIEFjcXVpcmVzIHNjaGVkdWxpbmcgYW5kIGRpc3BhdGNoIG93bmVyc2hpcCBmb3IgYW4gYWN0aXZlIGdlbmVyYXRpb24uXG4gICAqIEBwYXJhbSB7XCJhY3RpdmVcIiB8IFwiY2FuZGlkYXRlXCJ9IGV4cGVjdGVkTGlmZWN5Y2xlU3RhdGUgLSBTdGF0ZSB0aGF0IHN0aWxsIG93bnMgYWN0aXZhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBhY3RpdmUgb3duZXJzaGlwIHdhcyBlc3RhYmxpc2hlZC5cbiAgICovXG4gIGFzeW5jIF9zdGFydEFjdGl2ZU93bmVyc2hpcChleHBlY3RlZExpZmVjeWNsZVN0YXRlKSB7XG4gICAgYXdhaXQgdGhpcy5zdG9yZS5yZWNvbmNpbGVRdWV1ZUNvbmN1cnJlbmN5KClcbiAgICBpZiAodGhpcy5saWZlY3ljbGVTdGF0ZSAhPT0gZXhwZWN0ZWRMaWZlY3ljbGVTdGF0ZSkgcmV0dXJuIGZhbHNlXG4gICAgdGhpcy5fc2V0dXBEaXNwYXRjaFRyaWdnZXJzKClcbiAgICB0aGlzLl9zZXR1cFN0YXJ0dXBIYW5kb2ZmUmVjbGFpbSgpXG4gICAgdGhpcy5fc3RhcnRPcnBoYW5Td2VlcCgpXG4gICAgYXdhaXQgdGhpcy5fc3RhcnRTY2hlZHVsZXIoKVxuICAgIGlmICh0aGlzLmxpZmVjeWNsZVN0YXRlICE9PSBleHBlY3RlZExpZmVjeWNsZVN0YXRlKSB7XG4gICAgICBpZiAodGhpcy5zY2hlZHVsZXIpIGF3YWl0IHRoaXMuc2NoZWR1bGVyLnN0b3AoKVxuICAgICAgdGhpcy5zY2hlZHVsZXIgPSB1bmRlZmluZWRcbiAgICAgIHRoaXMuX2NsZWFyRGlzcGF0Y2hUaW1lcnMoKVxuICAgICAgdGhpcy5fZGlzY29ubmVjdEJlYWNvbkhhbmRsZXJzKClcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cbiAgICB0aGlzLl9hY3RpdmVPd25lcnNoaXBSZWFkeSA9IHRydWVcbiAgICB0aGlzLl9jcmVkaXRSZWFkeVdvcmtlcnMoKVxuICAgIGF3YWl0IHRoaXMuX2RyYWluKClcbiAgICByZXR1cm4gdGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gZXhwZWN0ZWRMaWZlY3ljbGVTdGF0ZVxuICB9XG5cbiAgLyoqIFN0YXJ0cyBleGFjdCByZWNvdmVyeSBkdXRpZXMgd2l0aG91dCBhY3F1aXJpbmcgZ2xvYmFsIGRpc3BhdGNoIG93bmVyc2hpcC4gKi9cbiAgX3N0YXJ0R2VuZXJhdGlvblJlY292ZXJ5T3duZXJzaGlwKCkge1xuICAgIHRoaXMuX3NldHVwU3RhcnR1cEhhbmRvZmZSZWNsYWltKClcbiAgICB0aGlzLl9zdGFydE9ycGhhblN3ZWVwKClcbiAgICB0aGlzLl9tYXliZVN0b3BSZXRpcmVkKClcbiAgfVxuXG4gIC8qKiBTdGFydHMgdGhlIGdlbmVyYXRpb24tZmVuY2VkIG9ycGhhbiBzd2VlcC4gKi9cbiAgX3N0YXJ0T3JwaGFuU3dlZXAoKSB7XG4gICAgaWYgKHRoaXMuX29ycGhhblRpbWVyKSByZXR1cm5cblxuICAgIHRoaXMuX29ycGhhblRpbWVyID0gc2V0SW50ZXJ2YWwoKCkgPT4geyB2b2lkIHRoaXMuX3N3ZWVwT3JwaGFucygpIH0sIDYwMDAwKVxuICB9XG5cbiAgLyoqXG4gICAqIFN0YXJ0cyBzY2hlZHVsZSBvd25lcnNoaXAgZXhhY3RseSBvbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBzY2hlZHVsZXMgYXJlIGxvYWRlZC5cbiAgICovXG4gIGFzeW5jIF9zdGFydFNjaGVkdWxlcigpIHtcbiAgICBpZiAodGhpcy5zY2hlZHVsZXIpIHJldHVyblxuXG4gICAgdGhpcy5zY2hlZHVsZXIgPSBuZXcgQmFja2dyb3VuZEpvYnNTY2hlZHVsZXIoe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgZW5xdWV1ZUpvYjogYXN5bmMgKHthcmdzLCBqb2JDbGFzcywgb3B0aW9uc30pID0+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5zdG9yZS5lbnF1ZXVlKHtcbiAgICAgICAgICBqb2JOYW1lOiBqb2JDbGFzcy5qb2JOYW1lKCksXG4gICAgICAgICAgYXJncyxcbiAgICAgICAgICBvcHRpb25zOiBqb2JDbGFzcy5fd2l0aEpvYkNvbnRleHQoe2pvYkFyZ3M6IGFyZ3MsIGpvYk9wdGlvbnM6IG9wdGlvbnN9KVxuICAgICAgICB9KVxuICAgICAgICB0aGlzLl9ub3RpZnlFbnF1ZXVlZCgpXG4gICAgICAgIHZvaWQgdGhpcy5fZHJhaW4oKVxuICAgICAgfVxuICAgIH0pXG4gICAgYXdhaXQgdGhpcy5zY2hlZHVsZXIuc3RhcnQoKVxuXG4gICAgY29uc3QgcmV0ZW50aW9uU2NoZWR1bGUgPSBQcnVuZVRlcm1pbmFsQmFja2dyb3VuZEpvYnNKb2Iuc2NoZWR1bGVDb25maWd1cmF0aW9uKHRoaXMucmV0ZW50aW9uKVxuXG4gICAgaWYgKHJldGVudGlvblNjaGVkdWxlKSB7XG4gICAgICB0aGlzLnNjaGVkdWxlci5zY2hlZHVsZUpvYih7am9iQ29uZmlndXJhdGlvbjogcmV0ZW50aW9uU2NoZWR1bGUsIGpvYktleTogXCJ2ZWxvY2lvdXNQcnVuZVRlcm1pbmFsQmFja2dyb3VuZEpvYnNcIn0pXG4gICAgfVxuICB9XG5cbiAgLyoqIENyZWRpdHMgcmVhZGluZXNzIGFkdmVydGlzZW1lbnRzIHJlY29yZGVkIHdoaWxlIGRpc3BhdGNoIHdhcyBmZW5jZWQuICovXG4gIF9jcmVkaXRSZWFkeVdvcmtlcnMoKSB7XG4gICAgZm9yIChjb25zdCB3b3JrZXIgb2YgdGhpcy5jYW5kaWRhdGVSZWFkeVdvcmtlcnMpIHtcbiAgICAgIGlmICh0aGlzLndvcmtlcnMuaGFzKHdvcmtlcikgJiYgIXdvcmtlci5pc0RyYWluaW5nICYmIHdvcmtlci5zdXBwb3J0c0hhbmRvZmZJZFJlcG9ydGluZykge1xuICAgICAgICB0aGlzLnJlYWR5V29ya2Vycy5hZGQod29ya2VyKVxuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLmNhbmRpZGF0ZVJlYWR5V29ya2Vycy5jbGVhcigpXG4gIH1cblxuICAvKipcbiAgICogQWN0aXZhdGVzIGEgY2FuZGlkYXRlIGFmdGVyIGl0cyBzdXBlcnZpc29yIGhhcyByZXRpcmVkIHRoZSBvbGQgZ2VuZXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgc2NoZWR1bGluZyBhbmQgZGlzcGF0Y2ggYXJlIGFjdGl2ZS5cbiAgICovXG4gIGFjdGl2YXRlKCkge1xuICAgIGlmICghdGhpcy5nZW5lcmF0aW9uSWQpIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyBnZW5lcmF0aW9uIGFjdGl2YXRpb24gcmVxdWlyZXMgZ2VuZXJhdGlvbiBtb2RlXCIpXG4gICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwiYWN0aXZlXCIpIHJldHVybiBQcm9taXNlLnJlc29sdmUoKVxuICAgIGlmICh0aGlzLmxpZmVjeWNsZVN0YXRlICE9PSBcImNhbmRpZGF0ZVwiKSB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBhY3RpdmF0ZSBiYWNrZ3JvdW5kIGpvYnMgZ2VuZXJhdGlvbiBmcm9tICR7dGhpcy5saWZlY3ljbGVTdGF0ZX1gKVxuICAgIGlmICghdGhpcy5fYWN0aXZhdGlvblByb21pc2UpIHRoaXMuX2FjdGl2YXRpb25Qcm9taXNlID0gdGhpcy5fYWN0aXZhdGUoKVxuXG4gICAgcmV0dXJuIHRoaXMuX2FjdGl2YXRpb25Qcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhY3RpdmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBBY3RpdmF0aW9uIGNvbXBsZXRpb24uXG4gICAqL1xuICBhc3luYyBfYWN0aXZhdGUoKSB7XG4gICAgdGhpcy5sb2dnZXIuaW5mbygoKSA9PiBbXCJCYWNrZ3JvdW5kIGpvYnMgZ2VuZXJhdGlvbiBhY3RpdmF0aW9uIHN0YXJ0aW5nXCIsIHtnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkfV0pXG4gICAgY29uc3Qgb3duZXJzaGlwU3RhcnRlZCA9IGF3YWl0IHRoaXMuX3N0YXJ0QWN0aXZlT3duZXJzaGlwKFwiY2FuZGlkYXRlXCIpXG4gICAgaWYgKCFvd25lcnNoaXBTdGFydGVkIHx8IHRoaXMubGlmZWN5Y2xlU3RhdGUgIT09IFwiY2FuZGlkYXRlXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyBnZW5lcmF0aW9uIHJldGlyZW1lbnQgc3RhcnRlZCBiZWZvcmUgYWN0aXZhdGlvbiBhY3F1aXJlZCBvd25lcnNoaXBcIilcbiAgICB9XG4gICAgdGhpcy5saWZlY3ljbGVTdGF0ZSA9IFwiYWN0aXZlXCJcbiAgICB0aGlzLl9jcmVkaXRSZWFkeVdvcmtlcnMoKVxuICAgIHRoaXMubG9nZ2VyLmluZm8oKCkgPT4gW1wiQmFja2dyb3VuZCBqb2JzIGdlbmVyYXRpb24gYWN0aXZhdGlvbiBhY2tub3dsZWRnZWRcIiwge2dlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWR9XSlcbiAgICB2b2lkIHRoaXMuX2RyYWluKCkuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJCYWNrZ3JvdW5kIGpvYnMgZ2VuZXJhdGlvbiBwb3N0LWFjdGl2YXRpb24gZHJhaW4gZmFpbGVkXCIsIHtlcnJvciwgZ2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZH1dKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRXN0YWJsaXNoZXMgdGhlIHN5bmNocm9ub3VzIHJldGlyZW1lbnQgZmVuY2UgYW5kIHRoZW4gZHJhaW5zIG93bmVyc2hpcCBzZXR1cC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHJldGlyZW1lbnQgZmVuY2UgaXMgZHVyYWJsZSBpbiBtZW1vcnkuXG4gICAqL1xuICByZXRpcmUoKSB7XG4gICAgaWYgKCF0aGlzLmdlbmVyYXRpb25JZCkgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIGdlbmVyYXRpb24gcmV0aXJlbWVudCByZXF1aXJlcyBnZW5lcmF0aW9uIG1vZGVcIilcbiAgICBpZiAodGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJyZXRpcmluZ1wiIHx8IHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwicmV0aXJlZFwiKSByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKClcbiAgICBjb25zdCBhY3RpdmF0aW9uSW5Qcm9ncmVzcyA9IHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwiY2FuZGlkYXRlXCIgJiYgQm9vbGVhbih0aGlzLl9hY3RpdmF0aW9uUHJvbWlzZSlcbiAgICBpZiAodGhpcy5saWZlY3ljbGVTdGF0ZSAhPT0gXCJhY3RpdmVcIiAmJiAhYWN0aXZhdGlvbkluUHJvZ3Jlc3MpIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IHJldGlyZSBiYWNrZ3JvdW5kIGpvYnMgZ2VuZXJhdGlvbiBmcm9tICR7dGhpcy5saWZlY3ljbGVTdGF0ZX1gKVxuXG4gICAgdGhpcy5saWZlY3ljbGVTdGF0ZSA9IFwicmV0aXJpbmdcIlxuICAgIHRoaXMuX2FjdGl2ZU93bmVyc2hpcFJlYWR5ID0gZmFsc2VcbiAgICB0aGlzLnJlYWR5V29ya2Vycy5jbGVhcigpXG4gICAgdGhpcy5jYW5kaWRhdGVSZWFkeVdvcmtlcnMuY2xlYXIoKVxuICAgIHRoaXMuX2NsZWFyRGlzcGF0Y2hUaW1lcnMoKVxuICAgIHRoaXMuX2Rpc2Nvbm5lY3RCZWFjb25IYW5kbGVycygpXG4gICAgdGhpcy5fcmV0aXJlbWVudFByb21pc2UgPSB0aGlzLl9yZXRpcmUoKVxuICAgIHZvaWQgdGhpcy5fcmV0aXJlbWVudFByb21pc2UuY2F0Y2goKGVycm9yKSA9PiB0aGlzLl9yZXBvcnRDb25uZWN0aW9uSGFuZGxlckVycm9yKGVycm9yKSlcblxuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmV0aXJlbWVudCBhZnRlciBpdHMgc3luY2hyb25vdXMgZmVuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJldGlyZW1lbnQgZmVuY2UgY29tcGxldGlvbi5cbiAgICovXG4gIGFzeW5jIF9yZXRpcmUoKSB7XG4gICAgaWYgKHRoaXMuX2FjdGl2YXRpb25Qcm9taXNlKSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoW3RoaXMuX2FjdGl2YXRpb25Qcm9taXNlXSlcbiAgICBpZiAodGhpcy5zY2hlZHVsZXIpIGF3YWl0IHRoaXMuc2NoZWR1bGVyLnN0b3AoKVxuICAgIHRoaXMuc2NoZWR1bGVyID0gdW5kZWZpbmVkXG4gICAgaWYgKHRoaXMuX2RyYWluUHJvbWlzZSkgYXdhaXQgdGhpcy5fZHJhaW5Qcm9taXNlXG4gICAgaWYgKHRoaXMuX3N0b3BwZWQpIHJldHVyblxuXG4gICAgZm9yIChjb25zdCB3b3JrZXIgb2YgdGhpcy53b3JrZXJzKSB7XG4gICAgICB3b3JrZXIuaXNEcmFpbmluZyA9IHRydWVcbiAgICAgIHdvcmtlci5zZW5kKHt0eXBlOiBcInJldGlyZVwiLCBnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkfSlcbiAgICB9XG5cbiAgICB0aGlzLmxpZmVjeWNsZVN0YXRlID0gXCJyZXRpcmVkXCJcbiAgICB0aGlzLl9zdGFydEdlbmVyYXRpb25SZWNvdmVyeU93bmVyc2hpcCgpXG4gIH1cblxuICAvKiogQ2xlYXJzIHRpbWVycyB0aGF0IGNhbiBpbml0aWF0ZSBuZXcgZ2xvYmFsIGRpc3BhdGNoIG9yIHNjaGVkdWxlIHdvcmsuICovXG4gIF9jbGVhckRpc3BhdGNoVGltZXJzKCkge1xuICAgIGlmICh0aGlzLl9wb2xsVGltZXIpIGNsZWFySW50ZXJ2YWwodGhpcy5fcG9sbFRpbWVyKVxuICAgIGlmICh0aGlzLl9zY2hlZHVsZWRUaW1lcikgY2xlYXJUaW1lb3V0KHRoaXMuX3NjaGVkdWxlZFRpbWVyKVxuICAgIGlmICh0aGlzLl9lcnJvclJldHJ5VGltZXIpIGNsZWFyVGltZW91dCh0aGlzLl9lcnJvclJldHJ5VGltZXIpXG4gICAgdGhpcy5fcG9sbFRpbWVyID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fc2NoZWR1bGVkVGltZXIgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9lcnJvclJldHJ5VGltZXIgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKiBIb2xkcyB0aGUgbWFpbiBvcGVuIHVudGlsIGEgbGlmZWN5Y2xlIHJlc3BvbnNlIGhhcyBmbHVzaGVkLiAqL1xuICBhY3F1aXJlTGlmZWN5Y2xlUmVxdWVzdExlYXNlKCkgeyB0aGlzLl9saWZlY3ljbGVSZXF1ZXN0TGVhc2VzICs9IDEgfVxuXG4gIC8qKiBSZWxlYXNlcyBvbmUgbGlmZWN5Y2xlLXJlc3BvbnNlIGxlYXNlIGFmdGVyIGl0cyBzb2NrZXQgd3JpdGUgY2FsbGJhY2suICovXG4gIHJlbGVhc2VMaWZlY3ljbGVSZXF1ZXN0TGVhc2UoKSB7XG4gICAgaWYgKHRoaXMuX2xpZmVjeWNsZVJlcXVlc3RMZWFzZXMgPCAxKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBiYWNrZ3JvdW5kIGpvYnMgbGlmZWN5Y2xlIHJlcXVlc3QgbGVhc2UgdG8gcmVsZWFzZVwiKVxuICAgIHRoaXMuX2xpZmVjeWNsZVJlcXVlc3RMZWFzZXMgLT0gMVxuICAgIHRoaXMuX21heWJlU3RvcFJldGlyZWQoKVxuICB9XG5cbiAgLyoqIFN0b3BzIGEgcmV0aXJlZCBnZW5lcmF0aW9uIG9ubHkgYWZ0ZXIgaXRzIGV4YWN0IG93bmVyc2hpcCBoYXMgZHJhaW5lZC4gKi9cbiAgX21heWJlU3RvcFJldGlyZWQoKSB7XG4gICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgIT09IFwicmV0aXJlZFwiIHx8IHRoaXMuX3N0b3BwZWQgfHwgdGhpcy5zdG9wUHJvbWlzZSkgcmV0dXJuXG4gICAgaWYgKHRoaXMuX2xpZmVjeWNsZVJlcXVlc3RMZWFzZXMgPiAwIHx8IHRoaXMuX2FjdGl2ZU5vbldvcmtlclJlcXVlc3RzID4gMCB8fCB0aGlzLndvcmtlcnMuc2l6ZSA+IDAgfHwgdGhpcy5kaXNjb25uZWN0ZWRXb3JrZXJzLnNpemUgPiAwKSByZXR1cm5cbiAgICBpZiAodGhpcy5pbmZsaWdodFdvcmtlckhhbmRvZmZBZG9wdGlvbnMuc2l6ZSA+IDAgfHwgdGhpcy5wZW5kaW5nSGFuZG9mZlJlY292ZXJpZXMuc2l6ZSA+IDApIHJldHVyblxuICAgIGlmICh0aGlzLl9kcmFpblByb21pc2UgfHwgdGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltUHJvbWlzZSB8fCB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1UaW1lcikgcmV0dXJuXG4gICAgaWYgKHRoaXMuc3RhcnR1cEhhbmRvZmZTbmFwc2hvdC5sZW5ndGggPiAwKSByZXR1cm5cblxuICAgIGZvciAoY29uc3QgaGFuZG9mZnMgb2YgdGhpcy53b3JrZXJIYW5kb2Zmcy52YWx1ZXMoKSkge1xuICAgICAgaWYgKGhhbmRvZmZzLnNpemUgPiAwKSByZXR1cm5cbiAgICB9XG5cbiAgICB2b2lkIHRoaXMuc3RvcCgpLmNhdGNoKChlcnJvcikgPT4gdGhpcy5fcmVwb3J0Q29ubmVjdGlvbkhhbmRsZXJFcnJvcihlcnJvcikpXG4gIH1cblxuICAvKipcbiAgICogV2lyZXMgdXAgdGhlIGRpc3BhdGNoLXRyaWdnZXJpbmcgc2lnbmFsIHNvdXJjZXMgZm9yIHRoZSBjb25maWd1cmVkXG4gICAqIHN0cmF0ZWd5LiBJbiBgXCJiZWFjb25cImAgbW9kZSAoZGVmYXVsdCkgdGhpcyBtZWFucyBzdWJzY3JpYmluZyB0byB0aGVcbiAgICogYHZlbG9jaW91cy1iYWNrZ3JvdW5kLWpvYnMtZGlzcGF0Y2hgIGNoYW5uZWwgZm9yIGNyb3NzLXByb2Nlc3NcbiAgICogd2FrZS11cHMsIGxpc3RlbmluZyBmb3IgQmVhY29uIChyZSljb25uZWN0cyB0byBjYXRjaCB1cCBvbiBtaXNzZWRcbiAgICogd29yaywgYW5kIHJlbHlpbmcgb24gZGlyZWN0IGluLXByb2Nlc3MgY2FsbHMgZnJvbSBgX2hhbmRsZUVucXVldWVgLFxuICAgKiBgX2hhbmRsZUpvYkNvbXBsZXRlYC9gRmFpbGVkYCwgd29ya2VyIGhlbGxvL3JlYWR5LCBhbmQgdGhlXG4gICAqIHNjaGVkdWxlZC1qb2IgYHNldFRpbWVvdXRgLiBJbiBgXCJwb2xsaW5nXCJgIG1vZGUgd2UgcmVzdG9yZSB0aGVcbiAgICogbGVnYWN5IGZpeGVkLWludGVydmFsIHBvbGwgZm9yIHVzZXJzIHdobyB3YW50IHRoZSBwcmV2aW91cyBiZWhhdmlvci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2V0dXBEaXNwYXRjaFRyaWdnZXJzKCkge1xuICAgIGlmICh0aGlzLmRpc3BhdGNoU3RyYXRlZ3kgPT09IFwicG9sbGluZ1wiKSB7XG4gICAgICB0aGlzLl9wb2xsVGltZXIgPSBzZXRJbnRlcnZhbCgoKSA9PiB7XG4gICAgICAgIHZvaWQgdGhpcy5fcmV0cnlBZnRlckVycm9yKClcbiAgICAgIH0sIHRoaXMucG9sbEludGVydmFsTXMpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBiZWFjb25DbGllbnQgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmVhY29uQ2xpZW50KClcbiAgICBpZiAoIWJlYWNvbkNsaWVudCkgcmV0dXJuXG5cbiAgICB0aGlzLl9iZWFjb25DbGllbnQgPSBiZWFjb25DbGllbnRcblxuICAgIHRoaXMuX3Vuc3Vic2NyaWJlQmVhY29uID0gYmVhY29uQ2xpZW50Lm9uQnJvYWRjYXN0KChtZXNzYWdlKSA9PiB7XG4gICAgICBpZiAobWVzc2FnZT8uY2hhbm5lbCAhPT0gRElTUEFUQ0hfQ0hBTk5FTCkgcmV0dXJuXG4gICAgICB2b2lkIHRoaXMuX2RyYWluKClcbiAgICB9KVxuXG4gICAgLy8gRHJhaW4gb24gZXZlcnkgKHJlKWNvbm5lY3QgdG8gY2F0Y2ggdXAgb24gam9icyBlbnF1ZXVlZCB3aGlsZSB0aGVcbiAgICAvLyBidXMgd2FzIHVucmVhY2hhYmxlLiBUaGUgREIgaXMgdGhlIGR1cmFibGUgbG9nOyBCZWFjb24gaXMganVzdCB0aGVcbiAgICAvLyB3YWtlLXVwIHNpZ25hbC5cbiAgICB0aGlzLl9iZWFjb25Db25uZWN0SGFuZGxlciA9ICgpID0+IHtcbiAgICAgIHZvaWQgdGhpcy5fZHJhaW4oKVxuICAgIH1cbiAgICBiZWFjb25DbGllbnQub24oXCJjb25uZWN0XCIsIHRoaXMuX2JlYWNvbkNvbm5lY3RIYW5kbGVyKVxuICB9XG5cbiAgLyoqXG4gICAqIEFybXMgdGhlIGJvdW5kZWQgYWRvcHRpb24gZ3JhY2Ugb25seSB3aGVuIHN0YXJ0dXAgZm91bmQgZXhhY3QgcGVyc2lzdGVkXG4gICAqIGhhbmRvZmZzLiBUaGUgdGltZXIgaXMgdW5yZWZlZCBzbyBhbiBvdGhlcndpc2UtZmluaXNoZWQgcHJvY2VzcyBpcyBuZXZlclxuICAgKiByZXRhaW5lZCBzb2xlbHkgdG8gcGVyZm9ybSB0aGlzIGNsZWFudXAuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3NldHVwU3RhcnR1cEhhbmRvZmZSZWNsYWltKCkge1xuICAgIGlmICh0aGlzLnN0YXJ0dXBIYW5kb2ZmU25hcHNob3QubGVuZ3RoID09PSAwKSByZXR1cm5cbiAgICBpZiAodGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltVGltZXIgfHwgdGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltUHJvbWlzZSB8fCB0aGlzLl9zdGFydHVwSGFuZG9mZkdyYWNlRWxhcHNlZCkgcmV0dXJuXG5cbiAgICB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1UaW1lciA9IHRoaXMuY2xvY2suc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1UaW1lciA9IHVuZGVmaW5lZFxuICAgICAgdGhpcy5fc3RhcnR1cEhhbmRvZmZBZG9wdGlvbnNBdERlYWRsaW5lID0gWy4uLnRoaXMuaW5mbGlnaHRXb3JrZXJIYW5kb2ZmQWRvcHRpb25zXVxuICAgICAgdGhpcy5fc3RhcnR1cEhhbmRvZmZHcmFjZUVsYXBzZWQgPSB0cnVlXG4gICAgICB2b2lkIHRoaXMuX3N0YXJ0U3RhcnR1cEhhbmRvZmZSZWNsYWltKClcbiAgICB9LCB0aGlzLndvcmtlclJlY29ubmVjdEdyYWNlTXMpXG4gICAgaWYgKHR5cGVvZiB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1UaW1lciA9PT0gXCJvYmplY3RcIikgdGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltVGltZXIudW5yZWYoKVxuICB9XG5cbiAgLyoqXG4gICAqIFN0YXJ0cyBvbmUgdHJhY2tlZCBzdGFydHVwLXJlY2xhaW0gcGFzcywgY29hbGVzY2luZyBsaWZlY3ljbGUgYW5kIHJldHJ5XG4gICAqIGNhbGxlcnMgc28gc2h1dGRvd24gY2FuIHdhaXQgZm9yIGR1cmFibGUgbXV0YXRpb24gYmVmb3JlIGNsb3NpbmcgcG9vbHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoaXMgcGFzcyBzZXR0bGVzLlxuICAgKi9cbiAgX3N0YXJ0U3RhcnR1cEhhbmRvZmZSZWNsYWltKCkge1xuICAgIGlmICh0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1Qcm9taXNlKSByZXR1cm4gdGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltUHJvbWlzZVxuXG4gICAgY29uc3QgcmVjbGFpbSA9IHRoaXMuX3JlY2xhaW1EaXNjb25uZWN0ZWRTdGFydHVwSGFuZG9mZnMoKVxuXG4gICAgdGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltUHJvbWlzZSA9IHJlY2xhaW1cbiAgICBjb25zdCBjbGVhclJlY2xhaW0gPSAoKSA9PiB7XG4gICAgICBpZiAodGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltUHJvbWlzZSA9PT0gcmVjbGFpbSkge1xuICAgICAgICB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1Qcm9taXNlID0gdW5kZWZpbmVkXG4gICAgICB9XG4gICAgfVxuICAgIHZvaWQgcmVjbGFpbS50aGVuKGNsZWFyUmVjbGFpbSwgY2xlYXJSZWNsYWltKVxuXG4gICAgcmV0dXJuIHJlY2xhaW1cbiAgfVxuXG4gIC8qKlxuICAgKiBXYWl0cyBmb3IgYW4gYWxyZWFkeS1zdGFydGVkIHN0YXJ0dXAgcmVjbGFpbSBiZWZvcmUgYWRhcHRlciBzaHV0ZG93bi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBubyBwYXNzIHJlbWFpbnMuXG4gICAqL1xuICBhc3luYyBfZHJhaW5TdGFydHVwSGFuZG9mZlJlY2xhaW0oKSB7XG4gICAgd2hpbGUgKHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVByb21pc2UpIHtcbiAgICAgIGF3YWl0IHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVByb21pc2VcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogT3JwaGFucyBvbmx5IHN0YXJ0dXAtc25hcHNob3R0ZWQgbGVhc2VzIHdob3NlIHN0YWJsZSB3b3JrZXIgaWQgaGFzIG5vdCBiZWVuXG4gICAqIG9ic2VydmVkIGJ5IHRoaXMgbWFpbiBnZW5lcmF0aW9uLiBTdG9yZSBmZW5jaW5nIHJlamVjdHMgY29tcGxldGVkLFxuICAgKiByZXR1cm5lZCwgcmVwbGFjZWQsIGFuZCByZS1oYW5kZWQtb2ZmIHJvd3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHJlY2xhaW0gb3IgcmV0YWluZWQgcmV0cnkgc3RhdGUuXG4gICAqL1xuICBhc3luYyBfcmVjbGFpbURpc2Nvbm5lY3RlZFN0YXJ0dXBIYW5kb2ZmcygpIHtcbiAgICBpZiAodGhpcy5fc3RvcHBlZCB8fCAhdGhpcy5fc3RhcnR1cEhhbmRvZmZHcmFjZUVsYXBzZWQpIHJldHVyblxuICAgIGlmICh0aGlzLnN0YXJ0dXBIYW5kb2ZmU25hcHNob3QubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIGF3YWl0IHRoaXMuX3dhaXRGb3JTdGFydHVwSGFuZG9mZkFkb3B0aW9uc0F0RGVhZGxpbmUoKVxuICAgIGlmICh0aGlzLl9zdG9wcGVkKSByZXR1cm5cblxuICAgIGNvbnN0IGhhbmRvZmZzID0gdGhpcy5zdGFydHVwSGFuZG9mZlNuYXBzaG90LmZpbHRlcigoe3dvcmtlcklkfSkgPT4gIXRoaXMucmVjb25uZWN0ZWRXb3JrZXJJZHMuaGFzKHdvcmtlcklkKSlcblxuICAgIGlmIChoYW5kb2Zmcy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRoaXMuc3RhcnR1cEhhbmRvZmZTbmFwc2hvdCA9IFtdXG4gICAgICB0aGlzLl9tYXliZVN0b3BSZXRpcmVkKClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGxldCBvcnBoYW5lZEpvYnNcblxuICAgIHRyeSB7XG4gICAgICBvcnBoYW5lZEpvYnMgPSBhd2FpdCB0aGlzLnN0b3JlLm1hcmtPcnBoYW5lZEhhbmRvZmZzKHtcbiAgICAgICAgZXJyb3I6IFwiSm9iIG9ycGhhbmVkIGFmdGVyIGl0cyBwcmUtcmVzdGFydCB3b3JrZXIgZGlkIG5vdCByZWNvbm5lY3RcIixcbiAgICAgICAgaGFuZG9mZnNcbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuX3JlcG9ydFN0YXJ0dXBIYW5kb2ZmUmVjbGFpbUVycm9yKGVycm9yKVxuICAgICAgdGhpcy5fc2NoZWR1bGVFcnJvclJldHJ5KClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuc3RhcnR1cEhhbmRvZmZTbmFwc2hvdCA9IFtdXG4gICAgYXdhaXQgdGhpcy5faGFuZGxlT3JwaGFuZWRKb2JzKHtcbiAgICAgIGpvYnM6IG9ycGhhbmVkSm9icyxcbiAgICAgIHdhcm5pbmc6IFwiUmVjbGFpbWVkIGJhY2tncm91bmQgam9icyBmcm9tIHdvcmtlcnMgYWJzZW50IGFmdGVyIG1haW4gcmVzdGFydCBncmFjZVwiXG4gICAgfSlcbiAgICB0aGlzLm9uU3RhcnR1cEhhbmRvZmZzUmVjbGFpbWVkPy4ob3JwaGFuZWRKb2JzKVxuICAgIHRoaXMuX21heWJlU3RvcFJldGlyZWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIExldHMgYWRvcHRpb24gcXVlcmllcyBhbHJlYWR5IHJ1bm5pbmcgYXQgdGhlIHJlY29ubmVjdCBkZWFkbGluZSBzZXR0bGVcbiAgICogYmVmb3JlIHdvcmtlciBpZHMgYXJlIGZpbHRlcmVkLiBBIHNlY29uZCBib3VuZGVkIGdyYWNlIHByZXZlbnRzIGEgc3R1Y2tcbiAgICogYWRhcHRlciBxdWVyeSBmcm9tIGRlZmVycmluZyBzdGFydHVwIHJlY2xhaW0gZm9yZXZlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgZGVhZGxpbmUgc2V0IHNldHRsZXMgb3IgdGltZXMgb3V0LlxuICAgKi9cbiAgYXN5bmMgX3dhaXRGb3JTdGFydHVwSGFuZG9mZkFkb3B0aW9uc0F0RGVhZGxpbmUoKSB7XG4gICAgY29uc3QgYWRvcHRpb25zID0gdGhpcy5fc3RhcnR1cEhhbmRvZmZBZG9wdGlvbnNBdERlYWRsaW5lXG5cbiAgICB0aGlzLl9zdGFydHVwSGFuZG9mZkFkb3B0aW9uc0F0RGVhZGxpbmUgPSBbXVxuICAgIGlmIChhZG9wdGlvbnMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IHRpbWVyXG4gICAgY29uc3Qgd2FpdExpbWl0ID0gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIC8vIFRoaXMgbGlmZWN5Y2xlIGRlYWRsaW5lIG11c3Qgbm90IGtlZXAgdGhlIG1haW4gcHJvY2VzcyBhbGl2ZTsgdGhlXG4gICAgICAvLyBnZW5lcmljIHRpbWVvdXQgaGVscGVyIGludGVudGlvbmFsbHkgdXNlcyBhIHJlZmVyZW5jZWQgdGltZXIuXG4gICAgICB0aW1lciA9IHNldFRpbWVvdXQocmVzb2x2ZSwgdGhpcy53b3JrZXJSZWNvbm5lY3RHcmFjZU1zKVxuICAgICAgdGltZXIudW5yZWYoKVxuICAgIH0pXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgUHJvbWlzZS5yYWNlKFtQcm9taXNlLmFsbChhZG9wdGlvbnMpLCB3YWl0TGltaXRdKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAodGltZXIpIGNsZWFyVGltZW91dCh0aW1lcilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUHVibGlzaGVzIGEgZGlzcGF0Y2ggd2FrZS11cCBvbiB0aGUgQmVhY29uIGNoYW5uZWwuIE5vLW9wIGluIHBvbGxpbmdcbiAgICogbW9kZSBvciB3aGVuIEJlYWNvbiBpcyBub3QgY29ubmVjdGVkOyBpbiB0aG9zZSBjYXNlcyB0aGUgZGlyZWN0XG4gICAqIGluLXByb2Nlc3MgYF9kcmFpbigpYCBjYWxsIGluIHRoZSBlbnF1ZXVlL2hhbmRsZSBwYXRocyBpcyBzdWZmaWNpZW50XG4gICAqICh0aGVyZSBhcmUgbm8gb3RoZXIgcHJvY2Vzc2VzIHRvIG5vdGlmeSkuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX25vdGlmeUVucXVldWVkKCkge1xuICAgIGlmICh0aGlzLmRpc3BhdGNoU3RyYXRlZ3kgPT09IFwicG9sbGluZ1wiKSByZXR1cm5cblxuICAgIGNvbnN0IGJlYWNvbkNsaWVudCA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCZWFjb25DbGllbnQoKVxuICAgIGlmICghYmVhY29uQ2xpZW50IHx8ICFiZWFjb25DbGllbnQuaXNDb25uZWN0ZWQoKSkgcmV0dXJuXG5cbiAgICB0cnkge1xuICAgICAgYmVhY29uQ2xpZW50LnB1Ymxpc2goe1xuICAgICAgICBjaGFubmVsOiBESVNQQVRDSF9DSEFOTkVMLFxuICAgICAgICBicm9hZGNhc3RQYXJhbXM6IHt9LFxuICAgICAgICBib2R5OiB7YWN0aW9uOiBcIndha2VcIn1cbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oKCkgPT4gW1wiRmFpbGVkIHRvIHB1Ymxpc2ggYmFja2dyb3VuZCBqb2JzIHdha2UgYnJvYWRjYXN0OlwiLCBlcnJvcl0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibmV0XCIpLlNvY2tldH0gc29ja2V0IC0gU29ja2V0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9oYW5kbGVDb25uZWN0aW9uKHNvY2tldCkge1xuICAgIGNvbnN0IGpzb25Tb2NrZXQgPSBuZXcgSnNvblNvY2tldChzb2NrZXQpXG4gICAgdGhpcy5jb25uZWN0aW9ucy5hZGQoanNvblNvY2tldClcbiAgICAvKipcbiAgICAgKiBSb2xlLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTb2NrZXRSb2xlIHwgbnVsbH0gKi9cbiAgICBsZXQgcm9sZSA9IG51bGxcblxuICAgIGxldCBjbGVhbmVkVXAgPSBmYWxzZVxuICAgIGNvbnN0IGNsZWFudXAgPSAoKSA9PiB7XG4gICAgICBpZiAoY2xlYW5lZFVwKSByZXR1cm5cbiAgICAgIGNsZWFuZWRVcCA9IHRydWVcbiAgICAgIHRoaXMuY29ubmVjdGlvbnMuZGVsZXRlKGpzb25Tb2NrZXQpXG5cbiAgICAgIGlmIChyb2xlID09PSBcIndvcmtlclwiKSB2b2lkIHRoaXMuX2hhbmRsZVdvcmtlclNvY2tldENsb3NlZChqc29uU29ja2V0KVxuICAgICAgdGhpcy5fbWF5YmVTdG9wUmV0aXJlZCgpXG4gICAgfVxuXG4gICAganNvblNvY2tldC5vbihcImNsb3NlXCIsIGNsZWFudXApXG4gICAganNvblNvY2tldC5vbihcImVycm9yXCIsIChlcnJvcikgPT4ge1xuICAgICAgdGhpcy5sb2dnZXIud2FybigoKSA9PiBbXCJCYWNrZ3JvdW5kIGpvYnMgY29ubmVjdGlvbiBlcnJvcjpcIiwgZXJyb3JdKVxuICAgICAgY2xlYW51cCgpXG4gICAgfSlcblxuICAgIGxldCBtZXNzYWdlSGFuZGxpbmcgPSBQcm9taXNlLnJlc29sdmUoKVxuICAgIGpzb25Tb2NrZXQub24oXCJtZXNzYWdlXCIsIChtZXNzYWdlKSA9PiB7XG4gICAgICBtZXNzYWdlSGFuZGxpbmcgPSBtZXNzYWdlSGFuZGxpbmcudGhlbihhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGV4aXN0aW5nUm9sZSA9IHJvbGVcbiAgICAgICAgcm9sZSA9IGF3YWl0IHRoaXMuX2hhbmRsZVNvY2tldE1lc3NhZ2Uoe2pzb25Tb2NrZXQsIG1lc3NhZ2UsIHJvbGV9KVxuICAgICAgICBpZiAoZXhpc3RpbmdSb2xlID09PSBcImNsaWVudFwiIHx8IGV4aXN0aW5nUm9sZSA9PT0gXCJyZXBvcnRlclwiKSBqc29uU29ja2V0LmNsb3NlKClcbiAgICAgIH0pLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgICB0aGlzLl9yZXBvcnRDb25uZWN0aW9uSGFuZGxlckVycm9yKGVycm9yKVxuICAgICAgICBqc29uU29ja2V0LmNsb3NlKClcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTdXJmYWNlcyBhbiB1bmV4cGVjdGVkIHByb3RvY29sLWhhbmRsZXIgZmFpbHVyZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBIYW5kbGVyIGZhaWx1cmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlcG9ydENvbm5lY3Rpb25IYW5kbGVyRXJyb3IoZXJyb3IpIHtcbiAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICBjb25zdCBwYXlsb2FkID0ge2NvbnRleHQ6IHtzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYnMtc29ja2V0LWhhbmRsZXJcIn0sIGVycm9yOiBub3JtYWxpemVkRXJyb3J9XG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiQmFja2dyb3VuZCBqb2JzIHNvY2tldCBoYW5kbGVyIGZhaWxlZDpcIiwgbm9ybWFsaXplZEVycm9yXSlcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiZnJhbWV3b3JrLWVycm9yXCIsIHBheWxvYWQpXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4ucGF5bG9hZCwgZXJyb3JUeXBlOiBcImZyYW1ld29yay1lcnJvclwifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBzb2NrZXQgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNvY2tldE1lc3NhZ2V9IGFyZ3MubWVzc2FnZSAtIFNvY2tldCBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNvY2tldFJvbGUgfCBudWxsfSBhcmdzLnJvbGUgLSBDdXJyZW50IHNvY2tldCByb2xlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTb2NrZXRSb2xlIHwgbnVsbD59IC0gVXBkYXRlZCBzb2NrZXQgcm9sZS5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVTb2NrZXRNZXNzYWdlKHtqc29uU29ja2V0LCBtZXNzYWdlLCByb2xlfSkge1xuICAgIGlmICghcm9sZSkgcmV0dXJuIGF3YWl0IHRoaXMuX2hhbmRsZVJvbGVsZXNzU29ja2V0TWVzc2FnZSh7anNvblNvY2tldCwgbWVzc2FnZX0pXG4gICAgaWYgKHJvbGUgPT09IFwid29ya2VyXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZVdvcmtlclNvY2tldE1lc3NhZ2Uoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KVxuICAgICAgcmV0dXJuIHJvbGVcbiAgICB9XG5cbiAgICB0aGlzLl9hY3RpdmVOb25Xb3JrZXJSZXF1ZXN0cyArPSAxXG4gICAgdHJ5IHtcbiAgICAgIGlmIChyb2xlID09PSBcImNsaWVudFwiKSBhd2FpdCB0aGlzLl9oYW5kbGVDbGllbnRTb2NrZXRNZXNzYWdlKHtqc29uU29ja2V0LCBtZXNzYWdlfSlcbiAgICAgIGlmIChyb2xlID09PSBcInJlcG9ydGVyXCIpIGF3YWl0IHRoaXMuX2hhbmRsZVJlcG9ydGVyU29ja2V0TWVzc2FnZSh7anNvblNvY2tldCwgbWVzc2FnZX0pXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX2FjdGl2ZU5vbldvcmtlclJlcXVlc3RzIC09IDFcbiAgICAgIHRoaXMuX21heWJlU3RvcFJldGlyZWQoKVxuICAgIH1cblxuICAgIHJldHVybiByb2xlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgcm9sZWxlc3Mgc29ja2V0IG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLmpzb25Tb2NrZXQgLSBKU09OIHNvY2tldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTb2NrZXRNZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBTb2NrZXQgbWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU29ja2V0Um9sZSB8IG51bGw+fSAtIE5ldyBzb2NrZXQgcm9sZS5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVSb2xlbGVzc1NvY2tldE1lc3NhZ2Uoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KSB7XG4gICAgaWYgKG1lc3NhZ2U/LnR5cGUgIT09IFwiaGVsbG9cIikgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHJlamVjdGlvblJlYXNvbiA9IHRoaXMuX2dlbmVyYXRpb25IZWxsb1JlamVjdGlvblJlYXNvbihtZXNzYWdlKVxuXG4gICAgaWYgKHJlamVjdGlvblJlYXNvbikge1xuICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImdlbmVyYXRpb24tcmVqZWN0ZWRcIiwgcmVhc29uOiByZWplY3Rpb25SZWFzb259KVxuICAgICAganNvblNvY2tldC5jbG9zZSgpXG4gICAgICByZXR1cm4gbnVsbFxuICAgIH1cblxuICAgIGlmIChtZXNzYWdlLnJvbGUgPT09IFwid29ya2VyXCIpIHtcbiAgICAgIGlmICh0aGlzLl9zdG9wcGVkKSB7XG4gICAgICAgIGpzb25Tb2NrZXQuY2xvc2UoKVxuICAgICAgICByZXR1cm4gbWVzc2FnZS5yb2xlXG4gICAgICB9XG5cbiAgICAgIGlmICghKGF3YWl0IHRoaXMuX3JlZ2lzdGVyV29ya2VyKHtqc29uU29ja2V0LCBtZXNzYWdlfSkpKSByZXR1cm4gbnVsbFxuICAgIH1cblxuICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCkge1xuICAgICAganNvblNvY2tldC5zZW5kKHtcbiAgICAgICAgdHlwZTogXCJnZW5lcmF0aW9uLWFjY2VwdGVkXCIsXG4gICAgICAgIGdlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWQsXG4gICAgICAgIGxpZmVjeWNsZVN0YXRlOiB0aGlzLmxpZmVjeWNsZVN0YXRlXG4gICAgICB9KVxuICAgICAgaWYgKG1lc3NhZ2Uucm9sZSA9PT0gXCJ3b3JrZXJcIiAmJiAodGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJyZXRpcmluZ1wiIHx8IHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwicmV0aXJlZFwiKSkge1xuICAgICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwicmV0aXJlXCIsIGdlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWR9KVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBtZXNzYWdlLnJvbGVcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgdGhlIGdlbmVyYXRpb24gZmVuY2UgYmVmb3JlIGFzc2lnbmluZyBhIHNvY2tldCByb2xlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhlbGxvTWVzc2FnZX0gbWVzc2FnZSAtIEhlbGxvIG1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JzR2VuZXJhdGlvblJlamVjdGlvblJlYXNvbiB8IG51bGx9IC0gUmVqZWN0aW9uIHJlYXNvbi5cbiAgICovXG4gIF9nZW5lcmF0aW9uSGVsbG9SZWplY3Rpb25SZWFzb24obWVzc2FnZSkge1xuICAgIGNvbnN0IG1lc3NhZ2VIYXNHZW5lcmF0aW9uID0gT2JqZWN0Lmhhc093bihtZXNzYWdlLCBcImdlbmVyYXRpb25JZFwiKVxuXG4gICAgaWYgKCF0aGlzLmdlbmVyYXRpb25JZCkgcmV0dXJuIG1lc3NhZ2VIYXNHZW5lcmF0aW9uID8gXCJ1bmV4cGVjdGVkLWdlbmVyYXRpb25cIiA6IG51bGxcbiAgICBpZiAoIW1lc3NhZ2VIYXNHZW5lcmF0aW9uKSByZXR1cm4gXCJtaXNzaW5nLWdlbmVyYXRpb25cIlxuXG4gICAgdHJ5IHtcbiAgICAgIHZhbGlkYXRlR2VuZXJhdGlvbklkKG1lc3NhZ2UuZ2VuZXJhdGlvbklkLCBcImhlbGxvIGdlbmVyYXRpb25JZFwiKVxuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIFwibWFsZm9ybWVkLWdlbmVyYXRpb25cIlxuICAgIH1cblxuICAgIGlmIChtZXNzYWdlLmdlbmVyYXRpb25JZCAhPT0gdGhpcy5nZW5lcmF0aW9uSWQpIHJldHVybiBcImdlbmVyYXRpb24tbWlzbWF0Y2hcIlxuICAgIGlmIChtZXNzYWdlLnJvbGUgPT09IFwid29ya2VyXCIgJiYgIXdvcmtlcklkQmVsb25nc1RvR2VuZXJhdGlvbih7Z2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZCwgd29ya2VySWQ6IG1lc3NhZ2Uud29ya2VySWR9KSkge1xuICAgICAgcmV0dXJuIFwiZ2VuZXJhdGlvbi1taXNtYXRjaFwiXG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSBnZW5lcmF0aW9uLWZlbmNlZCB3b3JrZXIgYW5kIHRyYW5zZmVycyBvbmx5IGl0cyBleGFjdCBvd25lcnNoaXAuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gV29ya2VyIGhlbGxvLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIE5ldyBzb2NrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGVsbG9NZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBIZWxsby5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgd29ya2VyIHdhcyBhZG1pdHRlZC5cbiAgICovXG4gIGFzeW5jIF9yZWdpc3Rlcldvcmtlcih7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICBqc29uU29ja2V0LndvcmtlcklkID0gbWVzc2FnZS53b3JrZXJJZFxuICAgIGpzb25Tb2NrZXQuc3VwcG9ydHNIYW5kb2ZmSWRSZXBvcnRpbmcgPSBtZXNzYWdlLnN1cHBvcnRzSGFuZG9mZklkUmVwb3J0aW5nID09PSB0cnVlXG4gICAganNvblNvY2tldC5zdXBwb3J0c0hlYXJ0YmVhdCA9IG1lc3NhZ2Uuc3VwcG9ydHNIZWFydGJlYXQgPT09IHRydWVcbiAgICBqc29uU29ja2V0Lmxhc3RTZWVuQXQgPSB0aGlzLmNsb2NrLm5vdygpXG5cbiAgICBjb25zdCB3b3JrZXJJZCA9IGpzb25Tb2NrZXQud29ya2VySWRcbiAgICBjb25zdCBkaXNjb25uZWN0ZWQgPSB3b3JrZXJJZCA/IHRoaXMuZGlzY29ubmVjdGVkV29ya2Vycy5nZXQod29ya2VySWQpIDogdW5kZWZpbmVkXG4gICAgbGV0IGhhbmRvZmZzID0gZGlzY29ubmVjdGVkID8gdGhpcy53b3JrZXJIYW5kb2Zmcy5nZXQoZGlzY29ubmVjdGVkLndvcmtlcikgOiB1bmRlZmluZWRcbiAgICBjb25zdCByZWNvdmVyeU9ubHkgPSB0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcInJldGlyaW5nXCIgfHwgdGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJyZXRpcmVkXCJcblxuICAgIGlmIChyZWNvdmVyeU9ubHkgJiYgKCFoYW5kb2ZmcyB8fCBoYW5kb2Zmcy5zaXplID09PSAwKSkge1xuICAgICAgaWYgKCF3b3JrZXJJZCkgcmV0dXJuIGZhbHNlXG4gICAgICBjb25zdCBkdXJhYmxlSGFuZG9mZnMgPSBhd2FpdCB0aGlzLnN0b3JlLmhhbmRlZE9mZkpvYnNGb3JXb3JrZXIoe3dvcmtlcklkfSlcblxuICAgICAgaWYgKGR1cmFibGVIYW5kb2Zmcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImdlbmVyYXRpb24tcmVqZWN0ZWRcIiwgcmVhc29uOiBcIndvcmtlci1oYXMtbm8tcmVjb3ZlcmFibGUtaGFuZG9mZnNcIn0pXG4gICAgICAgIGpzb25Tb2NrZXQuY2xvc2UoKVxuICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgIH1cblxuICAgICAgaGFuZG9mZnMgPSBuZXcgTWFwKGR1cmFibGVIYW5kb2Zmcy5tYXAoKHtqb2JJZCwgaGFuZG9mZklkfSkgPT4gW2pvYklkLCBoYW5kb2ZmSWRdKSlcbiAgICAgIHRoaXMucmVjb25uZWN0ZWRXb3JrZXJJZHMuYWRkKHdvcmtlcklkKVxuICAgIH1cblxuICAgIGlmIChkaXNjb25uZWN0ZWQpIHtcbiAgICAgIHRoaXMuY2xvY2suY2xlYXJUaW1lb3V0KGRpc2Nvbm5lY3RlZC50aW1lcilcbiAgICAgIGlmICh3b3JrZXJJZCkgdGhpcy5kaXNjb25uZWN0ZWRXb3JrZXJzLmRlbGV0ZSh3b3JrZXJJZClcbiAgICAgIHRoaXMud29ya2VySGFuZG9mZnMuZGVsZXRlKGRpc2Nvbm5lY3RlZC53b3JrZXIpXG4gICAgfVxuXG4gICAgdGhpcy53b3JrZXJzLmFkZChqc29uU29ja2V0KVxuICAgIHRoaXMud29ya2VySGFuZG9mZnMuc2V0KGpzb25Tb2NrZXQsIGhhbmRvZmZzIHx8IG5ldyBNYXAoKSlcbiAgICBpZiAocmVjb3ZlcnlPbmx5KSBqc29uU29ja2V0LmlzRHJhaW5pbmcgPSB0cnVlXG4gICAgaWYgKCFoYW5kb2ZmcyAmJiB0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcImFjdGl2ZVwiKSB0aGlzLl90cmFja1dvcmtlckhhbmRvZmZBZG9wdGlvbihqc29uU29ja2V0KVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBUcmFja3MgYSB3b3JrZXIgaGFuZG9mZi1hZG9wdGlvbiBxdWVyeSB0aHJvdWdoIHNodXRkb3duLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGpzb25Tb2NrZXQgLSBSZWNvbm5lY3Rpbmcgd29ya2VyIHNvY2tldC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfdHJhY2tXb3JrZXJIYW5kb2ZmQWRvcHRpb24oanNvblNvY2tldCkge1xuICAgIGNvbnN0IGFkb3B0aW9uID0gdGhpcy5fYWRvcHRXb3JrZXJIYW5kb2Zmcyhqc29uU29ja2V0KVxuICAgIHRoaXMuaW5mbGlnaHRXb3JrZXJIYW5kb2ZmQWRvcHRpb25zLmFkZChhZG9wdGlvbilcbiAgICBjb25zdCByZW1vdmVBZG9wdGlvbiA9ICgpID0+IHtcbiAgICAgIHRoaXMuaW5mbGlnaHRXb3JrZXJIYW5kb2ZmQWRvcHRpb25zLmRlbGV0ZShhZG9wdGlvbilcbiAgICAgIHRoaXMuX21heWJlU3RvcFJldGlyZWQoKVxuICAgIH1cbiAgICB2b2lkIGFkb3B0aW9uLnRoZW4ocmVtb3ZlQWRvcHRpb24sIHJlbW92ZUFkb3B0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFdhaXRzIGZvciB3b3JrZXIgaGFuZG9mZi1hZG9wdGlvbiBxdWVyaWVzIHRvIGZpbmlzaC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBubyBhZG9wdGlvbiBxdWVyeSByZW1haW5zLlxuICAgKi9cbiAgYXN5bmMgX2RyYWluV29ya2VySGFuZG9mZkFkb3B0aW9ucygpIHtcbiAgICB3aGlsZSAodGhpcy5pbmZsaWdodFdvcmtlckhhbmRvZmZBZG9wdGlvbnMuc2l6ZSA+IDApIHtcbiAgICAgIGF3YWl0IFByb21pc2UuYWxsKFsuLi50aGlzLmluZmxpZ2h0V29ya2VySGFuZG9mZkFkb3B0aW9uc10pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFkb3B0cyBhIHJlY29ubmVjdGluZyB3b3JrZXIncyBzdGlsbC1hY3RpdmUgYGhhbmRlZF9vZmZgIGpvYnMgaW50byBpdHMgbmV3XG4gICAqIHNvY2tldCdzIGhhbmRvZmYgbWFwLiBBIGZyZXNoIG1haW4gKGUuZy4gYWZ0ZXIgYSBkZXBsb3kgcmVzdGFydCkgaG9sZHMgbm9cbiAgICogaW4tbWVtb3J5IGxlYXNlcywgc28gYSB3b3JrZXIgdGhhdCByZWNvbm5lY3RzIHdpdGggaXRzIHN0YWJsZSBpZCB3b3VsZFxuICAgKiBvdGhlcndpc2UgaGF2ZSBpdHMgcHJlLXJlc3RhcnQgam9icyB0cmFja2VkIG5vd2hlcmUg4oCUIGlmIGl0IHRoZW4gZGllZCwgdGhvc2VcbiAgICogbGVhc2VzIChhbmQgdGhlaXIgY29uY3VycmVuY3kgcmVzZXJ2YXRpb25zKSB3b3VsZCBzaXQgc3R1Y2sgdW50aWwgdGhlXG4gICAqIGhvdXJzLWxvbmcgb3JwaGFuIHN3ZWVwLiBBZG9wdGluZyB0aGVtIG1lYW5zIGBfaGFuZGxlV29ya2VyU29ja2V0Q2xvc2VkYFxuICAgKiByZWxlYXNlcyB0aGVtIG9uIHRoZSB3b3JrZXIncyBuZXh0IGRpc2Nvbm5lY3QsIHdoaWxlIGEgc3RpbGwtcnVubmluZyB3b3JrZXJcbiAgICogKGluY2x1ZGluZyBvbmUgZ3JhY2VmdWxseSBkcmFpbmluZykga2VlcHMgZXhlY3V0aW5nIHRoZW0gdW50b3VjaGVkLiBOb1xuICAgKiB0aW1lLWJhc2VkIHJlY2xhaW0gaXMgdXNlZCwgc28gYSBkcmFpbmluZyB3b3JrZXIgd2hvc2Ugam9icyBvdXRsaXZlIHRoZSBvbGRcbiAgICogbWFpbiBpcyBuZXZlciB3cm9uZ2x5IHJlcXVldWVkIGludG8gYSBkdXBsaWNhdGUgYXR0ZW1wdC5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBqc29uU29ja2V0IC0gVGhlIHJlY29ubmVjdGVkIHdvcmtlciBzb2NrZXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2Fkb3B0V29ya2VySGFuZG9mZnMoanNvblNvY2tldCkge1xuICAgIGNvbnN0IHdvcmtlcklkID0ganNvblNvY2tldC53b3JrZXJJZFxuXG4gICAgaWYgKHR5cGVvZiB3b3JrZXJJZCAhPT0gXCJzdHJpbmdcIiB8fCB3b3JrZXJJZC5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGhhbmRvZmZzID0gYXdhaXQgdGhpcy5zdG9yZS5oYW5kZWRPZmZKb2JzRm9yV29ya2VyKHt3b3JrZXJJZH0pXG4gICAgICBjb25zdCBtYXAgPSB0aGlzLndvcmtlckhhbmRvZmZzLmdldChqc29uU29ja2V0KVxuXG4gICAgICAvLyBUaGUgc29ja2V0IG1heSBoYXZlIGNsb3NlZCB3aGlsZSB0aGUgcXVlcnkgd2FzIGluIGZsaWdodDsgaXRzIG1hcCBpcyB0aGVuXG4gICAgICAvLyBnb25lIGFuZCB0aGUgam9icyBhcmUgbGVmdCBmb3IgdGhlIG9ycGhhbiBzd2VlcCByYXRoZXIgdGhhbiByZXN1cnJlY3RlZC5cbiAgICAgIGlmICghbWFwIHx8ICF0aGlzLndvcmtlcnMuaGFzKGpzb25Tb2NrZXQpKSByZXR1cm5cblxuICAgICAgZm9yIChjb25zdCB7am9iSWQsIGhhbmRvZmZJZH0gb2YgaGFuZG9mZnMpIHtcbiAgICAgICAgbWFwLnNldChqb2JJZCwgaGFuZG9mZklkKVxuICAgICAgfVxuICAgICAgdGhpcy5yZWNvbm5lY3RlZFdvcmtlcklkcy5hZGQod29ya2VySWQpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuX3JlcG9ydEhhbmRvZmZBZG9wdEVycm9yKGVycm9yKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBjbGllbnQgc29ja2V0IG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLmpzb25Tb2NrZXQgLSBKU09OIHNvY2tldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTb2NrZXRNZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBTb2NrZXQgbWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHJlcXVlc3QgaXMgYWNrbm93bGVkZ2VkLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZUNsaWVudFNvY2tldE1lc3NhZ2Uoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KSB7XG4gICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkICYmICh0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcInJldGlyaW5nXCIgfHwgdGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJyZXRpcmVkXCIpKSB7XG4gICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJlbnF1ZXVlXCIpIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJlbnF1ZXVlLWVycm9yXCIsIGVycm9yOiBcIkJhY2tncm91bmQgam9icyBnZW5lcmF0aW9uIGlzIHJldGlyZWRcIn0pXG4gICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJyZXBsYWNlLXNjaGVkdWxlZFwiKSBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwicmVwbGFjZS1zY2hlZHVsZWQtZXJyb3JcIiwgZXJyb3I6IFwiQmFja2dyb3VuZCBqb2JzIGdlbmVyYXRpb24gaXMgcmV0aXJlZFwifSlcbiAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImNhbmNlbC1zY2hlZHVsZWRcIikganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImNhbmNlbC1zY2hlZHVsZWQtZXJyb3JcIiwgZXJyb3I6IFwiQmFja2dyb3VuZCBqb2JzIGdlbmVyYXRpb24gaXMgcmV0aXJlZFwifSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImVucXVldWVcIikge1xuICAgICAgYXdhaXQgdGhpcy5faGFuZGxlRW5xdWV1ZSh7anNvblNvY2tldCwgbWVzc2FnZX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJyZXBsYWNlLXNjaGVkdWxlZFwiKSB7XG4gICAgICBhd2FpdCB0aGlzLl9oYW5kbGVSZXBsYWNlU2NoZWR1bGVkKHtqc29uU29ja2V0LCBtZXNzYWdlfSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImNhbmNlbC1zY2hlZHVsZWRcIikge1xuICAgICAgYXdhaXQgdGhpcy5faGFuZGxlQ2FuY2VsU2NoZWR1bGVkKHtqc29uU29ja2V0LCBtZXNzYWdlfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgd29ya2VyIHNvY2tldCBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy5qc29uU29ja2V0IC0gSlNPTiBzb2NrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU29ja2V0TWVzc2FnZX0gYXJncy5tZXNzYWdlIC0gU29ja2V0IG1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSB3b3JrZXIgbWVzc2FnZSBpcyBoYW5kbGVkLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZVdvcmtlclNvY2tldE1lc3NhZ2Uoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KSB7XG4gICAgLy8gQW55IG1lc3NhZ2UgZnJvbSB0aGUgd29ya2VyIHByb3ZlcyBpdCBpcyBhbGl2ZTsgdGhlIGxpdmVuZXNzIHN3ZWVwIHVzZXNcbiAgICAvLyB0aGlzIHRvIGRldGVjdCBhIHdlZGdlZC9zaWxlbnQgd29ya2VyLlxuICAgIGpzb25Tb2NrZXQubGFzdFNlZW5BdCA9IHRoaXMuY2xvY2subm93KClcblxuICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImhlYXJ0YmVhdFwiKSB7XG4gICAgICB0aGlzLm9uV29ya2VySGVhcnRiZWF0Py4oanNvblNvY2tldClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcInJlYWR5XCIpIHtcbiAgICAgIHRoaXMuX2hhbmRsZVdvcmtlclJlYWR5KHtqc29uU29ja2V0LCBtZXNzYWdlfSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImRyYWluaW5nXCIpIHtcbiAgICAgIHRoaXMuX2hhbmRsZVdvcmtlckRyYWluaW5nKHtqc29uU29ja2V0fSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuX2hhbmRsZVJlcG9ydGVyU29ja2V0TWVzc2FnZSh7anNvblNvY2tldCwgbWVzc2FnZX0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgcmVwb3J0ZXIgc29ja2V0IG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLmpzb25Tb2NrZXQgLSBKU09OIHNvY2tldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTb2NrZXRNZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBTb2NrZXQgbWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHJlcG9ydCBpcyBhY2tub3dsZWRnZWQuXG4gICAqL1xuICBhc3luYyBfaGFuZGxlUmVwb3J0ZXJTb2NrZXRNZXNzYWdlKHtqc29uU29ja2V0LCBtZXNzYWdlfSkge1xuICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCAmJiB0aGlzLl9nZW5lcmF0aW9uUmVwb3J0SXNJbnZhbGlkKG1lc3NhZ2UpKSB7XG4gICAgICBpZiAoXCJqb2JJZFwiIGluIG1lc3NhZ2UgJiYgdHlwZW9mIG1lc3NhZ2Uuam9iSWQgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImpvYi11cGRhdGUtZXJyb3JcIiwgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsIGVycm9yOiBcIkdlbmVyYXRpb24gb3duZXJzaGlwIHJlamVjdGVkXCJ9KVxuICAgICAgfVxuICAgICAgcmV0dXJuXG4gICAgfVxuICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImpvYi1jb21wbGV0ZVwiKSB7XG4gICAgICBhd2FpdCB0aGlzLl9oYW5kbGVKb2JDb21wbGV0ZSh7anNvblNvY2tldCwgbWVzc2FnZX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJqb2ItZmFpbGVkXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZUpvYkZhaWxlZCh7anNvblNvY2tldCwgbWVzc2FnZX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJqb2ItcmVzY2hlZHVsZVwiKSB7XG4gICAgICBhd2FpdCB0aGlzLl9oYW5kbGVKb2JSZXNjaGVkdWxlKHtqc29uU29ja2V0LCBtZXNzYWdlfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVxdWlyZXMgdGhlIGNvbXBsZXRlIGR1cmFibGUgbGVhc2UgaWRlbnRpdHkgYmVmb3JlIGEgZ2VuZXJhdGlvbi1tb2RlXG4gICAqIHJlcG9ydGVyIGNhbiBtdXRhdGUgYSBqb2IuIExlZ2FjeSByZXBvcnRlcnMga2VlcCB0aGVpciBwZXJtaXNzaXZlIHByb3RvY29sLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNvY2tldE1lc3NhZ2V9IG1lc3NhZ2UgLSBSZXBvcnRlciBtZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSByZXBvcnQgbGFja3MgaXRzIGV4YWN0IGdlbmVyYXRpb24gbGVhc2UuXG4gICAqL1xuICBfZ2VuZXJhdGlvblJlcG9ydElzSW52YWxpZChtZXNzYWdlKSB7XG4gICAgaWYgKG1lc3NhZ2U/LnR5cGUgIT09IFwiam9iLWNvbXBsZXRlXCIgJiYgbWVzc2FnZT8udHlwZSAhPT0gXCJqb2ItZmFpbGVkXCIgJiYgbWVzc2FnZT8udHlwZSAhPT0gXCJqb2ItcmVzY2hlZHVsZVwiKSByZXR1cm4gZmFsc2VcbiAgICBjb25zdCBnZW5lcmF0aW9uSWQgPSB0aGlzLmdlbmVyYXRpb25JZFxuICAgIGlmICghZ2VuZXJhdGlvbklkKSByZXR1cm4gZmFsc2VcblxuICAgIHJldHVybiB0eXBlb2YgbWVzc2FnZS5oYW5kb2ZmSWQgIT09IFwic3RyaW5nXCJcbiAgICAgIHx8IHR5cGVvZiBtZXNzYWdlLmhhbmRlZE9mZkF0TXMgIT09IFwibnVtYmVyXCJcbiAgICAgIHx8ICF3b3JrZXJJZEJlbG9uZ3NUb0dlbmVyYXRpb24oe2dlbmVyYXRpb25JZCwgd29ya2VySWQ6IG1lc3NhZ2Uud29ya2VySWR9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIHdvcmtlciByZWFkeS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJlYWR5TWVzc2FnZX0gYXJncy5tZXNzYWdlIC0gUmVhZHkgbWVzc2FnZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaGFuZGxlV29ya2VyUmVhZHkoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KSB7XG4gICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwicmV0aXJpbmdcIiB8fCB0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcInJldGlyZWRcIikge1xuICAgICAgdGhpcy5yZWFkeVdvcmtlcnMuZGVsZXRlKGpzb25Tb2NrZXQpXG4gICAgICB0aGlzLmNhbmRpZGF0ZVJlYWR5V29ya2Vycy5kZWxldGUoanNvblNvY2tldClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGpzb25Tb2NrZXQucmVhZGluZXNzVmVyc2lvbiArPSAxXG4gICAganNvblNvY2tldC5hY2NlcHRzU3Bhd25lZEpvYnMgPSBtZXNzYWdlLmFjY2VwdHNTcGF3bmVkICE9PSBmYWxzZSAmJiBtZXNzYWdlLmFjY2VwdHNGb3JrZWQgIT09IGZhbHNlXG4gICAganNvblNvY2tldC5hY2NlcHRzRm9ya2VkSm9icyA9IG1lc3NhZ2UuYWNjZXB0c0ZvcmtlZCAhPT0gZmFsc2VcbiAgICBqc29uU29ja2V0LmFjY2VwdHNQb29sZWRKb2JzID0gbWVzc2FnZS5hY2NlcHRzUG9vbGVkID09PSB0cnVlXG4gICAgY29uc3QgYXZhaWxhYmxlUG9vbGVkU2xvdHMgPSBtZXNzYWdlLmF2YWlsYWJsZVBvb2xlZFNsb3RzXG4gICAganNvblNvY2tldC51c2VzUG9vbGVkQ2FwYWNpdHlDcmVkaXRzID0gTnVtYmVyLmlzSW50ZWdlcihhdmFpbGFibGVQb29sZWRTbG90cylcbiAgICBqc29uU29ja2V0LmF2YWlsYWJsZVBvb2xlZFNsb3RzID0gTnVtYmVyLmlzSW50ZWdlcihhdmFpbGFibGVQb29sZWRTbG90cykgJiYgYXZhaWxhYmxlUG9vbGVkU2xvdHMgIT09IHVuZGVmaW5lZCAmJiBhdmFpbGFibGVQb29sZWRTbG90cyA+IDBcbiAgICAgID8gYXZhaWxhYmxlUG9vbGVkU2xvdHNcbiAgICAgIDogMFxuICAgIGpzb25Tb2NrZXQuYWNjZXB0c0lubGluZUpvYnMgPSBtZXNzYWdlLmFjY2VwdHNJbmxpbmUgIT09IGZhbHNlXG4gICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwiY2FuZGlkYXRlXCIpIHtcbiAgICAgIHRoaXMucmVhZHlXb3JrZXJzLmRlbGV0ZShqc29uU29ja2V0KVxuICAgICAgaWYgKCFqc29uU29ja2V0LmlzRHJhaW5pbmcpIHRoaXMuY2FuZGlkYXRlUmVhZHlXb3JrZXJzLmFkZChqc29uU29ja2V0KVxuICAgIH0gZWxzZSBpZiAodGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJhY3RpdmVcIiAmJiB0aGlzLl9hY3RpdmVPd25lcnNoaXBSZWFkeSAmJiBqc29uU29ja2V0LnN1cHBvcnRzSGFuZG9mZklkUmVwb3J0aW5nICYmICFqc29uU29ja2V0LmlzRHJhaW5pbmcpIHtcbiAgICAgIHRoaXMucmVhZHlXb3JrZXJzLmFkZChqc29uU29ja2V0KVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnJlYWR5V29ya2Vycy5kZWxldGUoanNvblNvY2tldClcbiAgICAgIHRoaXMuY2FuZGlkYXRlUmVhZHlXb3JrZXJzLmRlbGV0ZShqc29uU29ja2V0KVxuICAgIH1cbiAgICB0aGlzLm9uV29ya2VyUmVhZHk/Lihqc29uU29ja2V0KVxuICAgIHZvaWQgdGhpcy5fZHJhaW4oKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIHdvcmtlciBkcmFpbmluZy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9oYW5kbGVXb3JrZXJEcmFpbmluZyh7anNvblNvY2tldH0pIHtcbiAgICAvLyBUaGUgd29ya2VyIGlzIHNodXR0aW5nIGRvd24gZ3JhY2VmdWxseS4gU3RvcCBkaXNwYXRjaGluZyBuZXcgam9ic1xuICAgIC8vIHRvIGl0IGJ1dCBrZWVwIHRoZSBjb25uZWN0aW9uIGluIGB3b3JrZXJzYCBzbyBhbnkgaW4tZmxpZ2h0IGpvYlxuICAgIC8vIGl0J3Mgc3RpbGwgZHJhaW5pbmcgY2FuIHJlcG9ydCBpdHMgcmVzdWx0LlxuICAgIGpzb25Tb2NrZXQuaXNEcmFpbmluZyA9IHRydWVcbiAgICB0aGlzLnJlYWR5V29ya2Vycy5kZWxldGUoanNvblNvY2tldClcbiAgICB0aGlzLmNhbmRpZGF0ZVJlYWR5V29ya2Vycy5kZWxldGUoanNvblNvY2tldClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZW1vdmVzIGEgbG9zdCB3b3JrZXIgc29ja2V0IGFuZCByZWxlYXNlcyBvbmx5IGxlYXNlcyBkaXNwYXRjaGVkIHRocm91Z2ggaXQuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gd29ya2VyIC0gRGlzY29ubmVjdGVkIHdvcmtlciBzb2NrZXQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBDb29yZGluYXRpb24gb3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5xdWV1ZVJlZHJhaW5dIC0gUXVldWUgYW5vdGhlciBwYXNzIGluc3RlYWQgb2YgYXdhaXRpbmcgdGhlIGFjdGl2ZSBkcmFpbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgaXRzIGFjdGl2ZSBsZWFzZXMgYXJlIHJlbGVhc2VkLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZVdvcmtlclNvY2tldENsb3NlZCh3b3JrZXIsIHtxdWV1ZVJlZHJhaW4gPSBmYWxzZX0gPSB7fSkge1xuICAgIHRoaXMud29ya2Vycy5kZWxldGUod29ya2VyKVxuICAgIHRoaXMucmVhZHlXb3JrZXJzLmRlbGV0ZSh3b3JrZXIpXG4gICAgdGhpcy5jYW5kaWRhdGVSZWFkeVdvcmtlcnMuZGVsZXRlKHdvcmtlcilcblxuICAgIGlmICh0aGlzLl9zdG9wcGVkKSB7XG4gICAgICB0aGlzLndvcmtlckhhbmRvZmZzLmRlbGV0ZSh3b3JrZXIpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBoYW5kb2ZmcyA9IHRoaXMud29ya2VySGFuZG9mZnMuZ2V0KHdvcmtlcilcbiAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQgJiYgd29ya2VyLndvcmtlcklkICYmIGhhbmRvZmZzICYmIGhhbmRvZmZzLnNpemUgPiAwKSB7XG4gICAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuZGlzY29ubmVjdGVkV29ya2Vycy5nZXQod29ya2VyLndvcmtlcklkKVxuICAgICAgaWYgKGV4aXN0aW5nPy53b3JrZXIgPT09IHdvcmtlcikgcmV0dXJuXG4gICAgICBpZiAoZXhpc3RpbmcpIHRoaXMuY2xvY2suY2xlYXJUaW1lb3V0KGV4aXN0aW5nLnRpbWVyKVxuXG4gICAgICBjb25zdCB0aW1lciA9IHRoaXMuY2xvY2suc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIHRoaXMuZGlzY29ubmVjdGVkV29ya2Vycy5kZWxldGUod29ya2VyLndvcmtlcklkIHx8IFwiXCIpXG4gICAgICAgIHZvaWQgdGhpcy5fcmVsZWFzZVdvcmtlckhhbmRvZmZzKHdvcmtlcikudGhlbigoKSA9PiB7XG4gICAgICAgICAgaWYgKHdvcmtlci53b3JrZXJJZCkgdGhpcy5vbldvcmtlckhhbmRvZmZzUmVsZWFzZWQ/Lih3b3JrZXIud29ya2VySWQpXG4gICAgICAgIH0sIChlcnJvcikgPT4ge1xuICAgICAgICAgIHRoaXMuX3JlcG9ydEhhbmRvZmZSZWxlYXNlRXJyb3IoZXJyb3IpXG4gICAgICAgICAgdGhpcy5fc2NoZWR1bGVFcnJvclJldHJ5KClcbiAgICAgICAgfSlcbiAgICAgIH0sIHRoaXMud29ya2VyUmVjb25uZWN0R3JhY2VNcylcbiAgICAgIGlmICh0eXBlb2YgdGltZXIgPT09IFwib2JqZWN0XCIpIHRpbWVyLnVucmVmKClcbiAgICAgIHRoaXMuZGlzY29ubmVjdGVkV29ya2Vycy5zZXQod29ya2VyLndvcmtlcklkLCB7d29ya2VyLCB0aW1lcn0pXG4gICAgICB0aGlzLm9uV29ya2VyRGlzY29ubmVjdGVkPy4od29ya2VyLndvcmtlcklkKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VXb3JrZXJIYW5kb2Zmcyh3b3JrZXIsIHtxdWV1ZVJlZHJhaW59KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLl9yZXBvcnRIYW5kb2ZmUmVsZWFzZUVycm9yKGVycm9yKVxuICAgICAgdGhpcy5fc2NoZWR1bGVFcnJvclJldHJ5KClcbiAgICB9XG4gICAgdGhpcy5fbWF5YmVTdG9wUmV0aXJlZCgpXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgYWxsIGxlYXNlcyBzdGlsbCBvd25lZCBieSBvbmUgZXhhY3Qgd29ya2VyIHNvY2tldC5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSB3b3JrZXIgLSBXb3JrZXIgc29ja2V0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gQ29vcmRpbmF0aW9uIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MucXVldWVSZWRyYWluXSAtIFF1ZXVlIGFub3RoZXIgcGFzcyBpbnN0ZWFkIG9mIGF3YWl0aW5nIHRoZSBhY3RpdmUgZHJhaW4uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGZlbmNlZCByZWxlYXNlcyBhbmQgZGlzcGF0Y2ggd2FrZS11cC5cbiAgICovXG4gIGFzeW5jIF9yZWxlYXNlV29ya2VySGFuZG9mZnMod29ya2VyLCB7cXVldWVSZWRyYWluID0gZmFsc2V9ID0ge30pIHtcbiAgICBjb25zdCBoYW5kb2ZmcyA9IHRoaXMud29ya2VySGFuZG9mZnMuZ2V0KHdvcmtlcilcblxuICAgIGlmICghaGFuZG9mZnMgfHwgaGFuZG9mZnMuc2l6ZSA9PT0gMCkge1xuICAgICAgdGhpcy53b3JrZXJIYW5kb2Zmcy5kZWxldGUod29ya2VyKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBbam9iSWQsIGhhbmRvZmZJZF0gb2YgaGFuZG9mZnMpIHtcbiAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VIYW5kb2ZmKHtoYW5kb2ZmSWQsIGpvYklkLCB3b3JrZXJ9KVxuICAgIH1cblxuICAgIHRoaXMud29ya2VySGFuZG9mZnMuZGVsZXRlKHdvcmtlcilcbiAgICB0aGlzLl9ub3RpZnlFbnF1ZXVlZCgpXG4gICAgaWYgKHF1ZXVlUmVkcmFpbikge1xuICAgICAgdGhpcy5fcmVkcmFpblF1ZXVlZCA9IHRydWVcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwiYWN0aXZlXCIpIGF3YWl0IHRoaXMuX2RyYWluKClcbiAgICB9XG4gICAgdGhpcy5fbWF5YmVTdG9wUmV0aXJlZCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBvbmUgaWRlbXBvdGVudCBjb25kaXRpb25hbCBsZWFzZSByZWxlYXNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmhhbmRvZmZJZCAtIEhhbmRvZmYgbGVhc2UgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3Mud29ya2VyIC0gU29ja2V0IHRoYXQgcmVjZWl2ZWQgdGhlIGxlYXNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgZmVuY2VkIHRyYW5zaXRpb24uXG4gICAqL1xuICBhc3luYyBfcmVsZWFzZUhhbmRvZmYoe2hhbmRvZmZJZCwgam9iSWQsIHdvcmtlcn0pIHtcbiAgICBhd2FpdCB0aGlzLnN0b3JlLm1hcmtSZXR1cm5lZFRvUXVldWUoe2hhbmRvZmZJZCwgam9iSWR9KVxuXG4gICAgY29uc3QgaGFuZG9mZnMgPSB0aGlzLndvcmtlckhhbmRvZmZzLmdldCh3b3JrZXIpXG5cbiAgICBpZiAoaGFuZG9mZnM/LmdldChqb2JJZCkgPT09IGhhbmRvZmZJZCkgaGFuZG9mZnMuZGVsZXRlKGpvYklkKVxuICB9XG5cbiAgLyoqXG4gICAqIEZvcmdldHMgYSBzdWNjZXNzZnVsbHkgcmVwb3J0ZWQgbGVhc2Ugd2l0aG91dCByZWx5aW5nIG9uIHdvcmtlciBpZHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuaGFuZG9mZklkIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2ZvcmdldEhhbmRvZmYoe2hhbmRvZmZJZCwgam9iSWR9KSB7XG4gICAgZm9yIChjb25zdCBbd29ya2VyLCBoYW5kb2Zmc10gb2YgdGhpcy53b3JrZXJIYW5kb2Zmcykge1xuICAgICAgaWYgKGhhbmRvZmZzLmdldChqb2JJZCkgIT09IGhhbmRvZmZJZCkgY29udGludWVcblxuICAgICAgaGFuZG9mZnMuZGVsZXRlKGpvYklkKVxuICAgICAgaWYgKGhhbmRvZmZzLnNpemUgPT09IDAgJiYgIXRoaXMud29ya2Vycy5oYXMod29ya2VyKSkgdGhpcy53b3JrZXJIYW5kb2Zmcy5kZWxldGUod29ya2VyKVxuICAgICAgaWYgKGhhbmRvZmZzLnNpemUgPT09IDAgJiYgd29ya2VyLndvcmtlcklkKSB7XG4gICAgICAgIGNvbnN0IGRpc2Nvbm5lY3RlZCA9IHRoaXMuZGlzY29ubmVjdGVkV29ya2Vycy5nZXQod29ya2VyLndvcmtlcklkKVxuICAgICAgICBpZiAoZGlzY29ubmVjdGVkPy53b3JrZXIgPT09IHdvcmtlcikge1xuICAgICAgICAgIHRoaXMuY2xvY2suY2xlYXJUaW1lb3V0KGRpc2Nvbm5lY3RlZC50aW1lcilcbiAgICAgICAgICB0aGlzLmRpc2Nvbm5lY3RlZFdvcmtlcnMuZGVsZXRlKHdvcmtlci53b3JrZXJJZClcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgdGhpcy5fbWF5YmVTdG9wUmV0aXJlZCgpXG4gICAgICByZXR1cm5cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVwb3J0cyBhbiB1bmV4cGVjdGVkIGxlYXNlLXJlbGVhc2UgZmFpbHVyZSBvbiBmcmFtZXdvcmsgZXJyb3IgY2hhbm5lbHMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gUmVsZWFzZSBmYWlsdXJlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXBvcnRIYW5kb2ZmUmVsZWFzZUVycm9yKGVycm9yKSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG4gICAgY29uc3QgcGF5bG9hZCA9IHtjb250ZXh0OiB7c3RhZ2U6IFwiYmFja2dyb3VuZC1qb2ItaGFuZG9mZi1yZWxlYXNlXCJ9LCBlcnJvcjogbm9ybWFsaXplZEVycm9yfVxuICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIkZhaWxlZCB0byByZWxlYXNlIGRpc2Nvbm5lY3RlZCB3b3JrZXIgaGFuZG9mZnM6XCIsIG5vcm1hbGl6ZWRFcnJvcl0pXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gIH1cblxuICAvKipcbiAgICogUmVwb3J0cyBhbiB1bmV4cGVjdGVkIHdvcmtlci1oYW5kb2ZmIGFkb3B0aW9uIGZhaWx1cmUgb24gZnJhbWV3b3JrIGVycm9yXG4gICAqIGNoYW5uZWxzLiBBIGZhaWxlZCBhZG9wdGlvbiBpcyBub3QgZmF0YWwgKHRoZSB3b3JrZXIncyBqb2JzIHJlbWFpbiBhbmQgYXJlXG4gICAqIHJlY2xhaW1lZCBieSB0aGUgb3JwaGFuIHN3ZWVwKSwgYnV0IG11c3Qgc3VyZmFjZSByYXRoZXIgdGhhbiBiZSBzd2FsbG93ZWQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gQWRvcHRpb24gZmFpbHVyZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVwb3J0SGFuZG9mZkFkb3B0RXJyb3IoZXJyb3IpIHtcbiAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICBjb25zdCBwYXlsb2FkID0ge2NvbnRleHQ6IHtzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi1oYW5kb2ZmLWFkb3B0XCJ9LCBlcnJvcjogbm9ybWFsaXplZEVycm9yfVxuICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIkZhaWxlZCB0byBhZG9wdCByZWNvbm5lY3RlZCB3b3JrZXIgaGFuZG9mZnM6XCIsIG5vcm1hbGl6ZWRFcnJvcl0pXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gIH1cblxuICAvKipcbiAgICogUmVwb3J0cyBhbiB1bmV4cGVjdGVkIHN0YXJ0dXAtc25hcHNob3QgcmVjbGFpbSBmYWlsdXJlIHdoaWxlIHJldGFpbmluZyB0aGVcbiAgICogc25hcHNob3QgZm9yIHRoZSBkaXNwYXRjaGVyJ3MgZXhpc3RpbmcgdHJhbnNpZW50LWVycm9yIHJldHJ5IGxpZmVjeWNsZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBSZWNsYWltIGZhaWx1cmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlcG9ydFN0YXJ0dXBIYW5kb2ZmUmVjbGFpbUVycm9yKGVycm9yKSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG4gICAgY29uc3QgcGF5bG9hZCA9IHtjb250ZXh0OiB7c3RhZ2U6IFwiYmFja2dyb3VuZC1qb2Itc3RhcnR1cC1oYW5kb2ZmLXJlY2xhaW1cIn0sIGVycm9yOiBub3JtYWxpemVkRXJyb3J9XG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiRmFpbGVkIHRvIHJlY2xhaW0gZGlzY29ubmVjdGVkIHN0YXJ0dXAgaGFuZG9mZnM6XCIsIG5vcm1hbGl6ZWRFcnJvcl0pXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgZW5xdWV1ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkVucXVldWVNZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBNZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGhhbmRsZWQuXG4gICAqL1xuICBhc3luYyBfaGFuZGxlRW5xdWV1ZSh7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICB0cnkge1xuICAgICAgY29uc3Qgam9iSWQgPSBhd2FpdCB0aGlzLnN0b3JlLmVucXVldWUoe1xuICAgICAgICBqb2JOYW1lOiBtZXNzYWdlLmpvYk5hbWUsXG4gICAgICAgIGFyZ3M6IG1lc3NhZ2UuYXJncyB8fCBbXSxcbiAgICAgICAgb3B0aW9uczogbWVzc2FnZS5vcHRpb25zIHx8IHt9XG4gICAgICB9KVxuXG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiZW5xdWV1ZWRcIiwgam9iSWR9KVxuICAgICAgdGhpcy5fbm90aWZ5RW5xdWV1ZWQoKVxuICAgICAgYXdhaXQgdGhpcy5fZHJhaW4oKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLl9oYW5kbGVDbGllbnRNdXRhdGlvbkVycm9yKHtcbiAgICAgICAgY29udGV4dDoge2pvYk5hbWU6IG1lc3NhZ2Uuam9iTmFtZSwgc3RhZ2U6IFwiYmFja2dyb3VuZC1qb2ItZW5xdWV1ZVwifSxcbiAgICAgICAgZXJyb3IsXG4gICAgICAgIGZhbGxiYWNrTWVzc2FnZTogXCJGYWlsZWQgdG8gZW5xdWV1ZSBqb2JcIixcbiAgICAgICAganNvblNvY2tldCxcbiAgICAgICAgbG9nTWVzc2FnZTogXCJGYWlsZWQgdG8gZW5xdWV1ZSBiYWNrZ3JvdW5kIGpvYjpcIixcbiAgICAgICAgcmVzcG9uc2VUeXBlOiBcImVucXVldWUtZXJyb3JcIlxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSGFuZGxlcyBhIHN0YWJsZS1rZXkgcmVwbGFjZW1lbnQgcmVxdWVzdCBhbmQgcmUtYXJtcyBkaXNwYXRjaCBhZnRlcndhcmQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLmpzb25Tb2NrZXQgLSBKU09OIHNvY2tldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSZXBsYWNlU2NoZWR1bGVkTWVzc2FnZX0gYXJncy5tZXNzYWdlIC0gTWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBoYW5kbGVkLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZVJlcGxhY2VTY2hlZHVsZWQoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuc3RvcmUucmVwbGFjZVNjaGVkdWxlZCh7XG4gICAgICAgIHNjaGVkdWxlS2V5OiBtZXNzYWdlLnNjaGVkdWxlS2V5LFxuICAgICAgICBqb2JOYW1lOiBtZXNzYWdlLmpvYk5hbWUsXG4gICAgICAgIGFyZ3M6IG1lc3NhZ2UuYXJncyB8fCBbXSxcbiAgICAgICAgb3B0aW9uczogbWVzc2FnZS5vcHRpb25zIHx8IHt9XG4gICAgICB9KVxuXG4gICAgICB0aGlzLl9ub3RpZnlFbnF1ZXVlZCgpXG4gICAgICBhd2FpdCB0aGlzLl9kcmFpbigpXG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwic2NoZWR1bGUtcmVwbGFjZWRcIiwgLi4ucmVzdWx0fSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5faGFuZGxlQ2xpZW50TXV0YXRpb25FcnJvcih7XG4gICAgICAgIGNvbnRleHQ6IHtqb2JOYW1lOiBtZXNzYWdlLmpvYk5hbWUsIHNjaGVkdWxlS2V5OiBtZXNzYWdlLnNjaGVkdWxlS2V5LCBzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi1yZXBsYWNlLXNjaGVkdWxlZFwifSxcbiAgICAgICAgZXJyb3IsXG4gICAgICAgIGZhbGxiYWNrTWVzc2FnZTogXCJGYWlsZWQgdG8gcmVwbGFjZSBzY2hlZHVsZWQgam9iXCIsXG4gICAgICAgIGpzb25Tb2NrZXQsXG4gICAgICAgIGxvZ01lc3NhZ2U6IFwiRmFpbGVkIHRvIHJlcGxhY2Ugc2NoZWR1bGVkIGJhY2tncm91bmQgam9iOlwiLFxuICAgICAgICByZXNwb25zZVR5cGU6IFwicmVwbGFjZS1zY2hlZHVsZWQtZXJyb3JcIlxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSGFuZGxlcyBhIHN0YWJsZS1rZXkgY2FuY2VsbGF0aW9uIHJlcXVlc3QgYW5kIHJlLWFybXMgZGlzcGF0Y2ggYWZ0ZXJ3YXJkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy5qc29uU29ja2V0IC0gSlNPTiBzb2NrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iQ2FuY2VsU2NoZWR1bGVkTWVzc2FnZX0gYXJncy5tZXNzYWdlIC0gTWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBoYW5kbGVkLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZUNhbmNlbFNjaGVkdWxlZCh7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5zdG9yZS5jYW5jZWxTY2hlZHVsZWQobWVzc2FnZS5zY2hlZHVsZUtleSlcblxuICAgICAgdGhpcy5fbm90aWZ5RW5xdWV1ZWQoKVxuICAgICAgYXdhaXQgdGhpcy5fZHJhaW4oKVxuICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcInNjaGVkdWxlLWNhbmNlbGxlZFwiLCAuLi5yZXN1bHR9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLl9oYW5kbGVDbGllbnRNdXRhdGlvbkVycm9yKHtcbiAgICAgICAgY29udGV4dDoge3NjaGVkdWxlS2V5OiBtZXNzYWdlLnNjaGVkdWxlS2V5LCBzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi1jYW5jZWwtc2NoZWR1bGVkXCJ9LFxuICAgICAgICBlcnJvcixcbiAgICAgICAgZmFsbGJhY2tNZXNzYWdlOiBcIkZhaWxlZCB0byBjYW5jZWwgc2NoZWR1bGVkIGpvYlwiLFxuICAgICAgICBqc29uU29ja2V0LFxuICAgICAgICBsb2dNZXNzYWdlOiBcIkZhaWxlZCB0byBjYW5jZWwgc2NoZWR1bGVkIGJhY2tncm91bmQgam9iOlwiLFxuICAgICAgICByZXNwb25zZVR5cGU6IFwiY2FuY2VsLXNjaGVkdWxlZC1lcnJvclwiXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHNhZmUgdmFsaWRhdGlvbiBmYWlsdXJlcyBhbmQgcmVwb3J0cyB1bmV4cGVjdGVkIGNsaWVudCBtdXRhdGlvbnMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuY29udGV4dCAtIEZyYW1ld29yay1lcnJvciBjb250ZXh0LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmVycm9yIC0gTXV0YXRpb24gZmFpbHVyZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZmFsbGJhY2tNZXNzYWdlIC0gQ2xpZW50LXNhZmUgZmFsbGJhY2sgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLmpzb25Tb2NrZXQgLSBKU09OIHNvY2tldC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubG9nTWVzc2FnZSAtIEVycm9yIGxvZyBwcmVmaXguXG4gICAqIEBwYXJhbSB7XCJlbnF1ZXVlLWVycm9yXCIgfCBcInJlcGxhY2Utc2NoZWR1bGVkLWVycm9yXCIgfCBcImNhbmNlbC1zY2hlZHVsZWQtZXJyb3JcIn0gYXJncy5yZXNwb25zZVR5cGUgLSBSZXNwb25zZSB0eXBlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9oYW5kbGVDbGllbnRNdXRhdGlvbkVycm9yKHtjb250ZXh0LCBlcnJvciwgZmFsbGJhY2tNZXNzYWdlLCBqc29uU29ja2V0LCBsb2dNZXNzYWdlLCByZXNwb25zZVR5cGV9KSB7XG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgVmVsb2Npb3VzRXJyb3IgJiYgZXJyb3Iuc2FmZVRvRXhwb3NlKSB7XG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IHJlc3BvbnNlVHlwZSwgZXJyb3I6IGVycm9yLm1lc3NhZ2V9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG4gICAgY29uc3QgcGF5bG9hZCA9IHtjb250ZXh0LCBlcnJvcjogbm9ybWFsaXplZEVycm9yfVxuICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtsb2dNZXNzYWdlLCBub3JtYWxpemVkRXJyb3JdKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogcmVzcG9uc2VUeXBlLCBlcnJvcjogZmFsbGJhY2tNZXNzYWdlfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBqb2IgY29tcGxldGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLmpzb25Tb2NrZXQgLSBKU09OIHNvY2tldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JDb21wbGV0ZU1lc3NhZ2V9IGFyZ3MubWVzc2FnZSAtIE1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gaGFuZGxlZC5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVKb2JDb21wbGV0ZSh7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgYWNjZXB0ZWQgPSBhd2FpdCB0aGlzLnN0b3JlLm1hcmtDb21wbGV0ZWQoe1xuICAgICAgICBqb2JJZDogbWVzc2FnZS5qb2JJZCxcbiAgICAgICAgaGFuZG9mZklkOiBtZXNzYWdlLmhhbmRvZmZJZCxcbiAgICAgICAgd29ya2VySWQ6IG1lc3NhZ2Uud29ya2VySWQsXG4gICAgICAgIGhhbmRlZE9mZkF0TXM6IG1lc3NhZ2UuaGFuZGVkT2ZmQXRNc1xuICAgICAgfSlcbiAgICAgIGlmIChhY2NlcHRlZCAmJiBtZXNzYWdlLmhhbmRvZmZJZCkge1xuICAgICAgICB0aGlzLl9mb3JnZXRIYW5kb2ZmKHtoYW5kb2ZmSWQ6IG1lc3NhZ2UuaGFuZG9mZklkLCBqb2JJZDogbWVzc2FnZS5qb2JJZH0pXG4gICAgICB9XG4gICAgICB0aGlzLm9uSm9iVXBkYXRlZD8uKHthY2NlcHRlZCwgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsIHN0YXR1czogXCJjb21wbGV0ZWRcIn0pXG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiam9iLXVwZGF0ZWRcIiwgam9iSWQ6IG1lc3NhZ2Uuam9iSWR9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLl9yZXBvcnRKb2JVcGRhdGVGYWlsdXJlKHtlcnJvciwgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsIHN0YWdlOiBcImJhY2tncm91bmQtam9iLWNvbXBsZXRlXCJ9KVxuICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImpvYi11cGRhdGUtZXJyb3JcIiwgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsIGVycm9yOiBcIkZhaWxlZCB0byB1cGRhdGUgam9iXCJ9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTdXJmYWNlcyBhbiB1bmV4cGVjdGVkIGR1cmFibGUgcmVwb3J0IGZhaWx1cmUgd2l0aG91dCBleHBvc2luZyBpdCB0byB0aGVcbiAgICogcmVwb3J0aW5nIHBlZXIuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRmFpbHVyZSBjb250ZXh0LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmVycm9yIC0gQWRhcHRlciBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIER1cmFibGUgam9iIGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zdGFnZSAtIE11dGF0aW9uIHN0YWdlLlxuICAgKi9cbiAgX3JlcG9ydEpvYlVwZGF0ZUZhaWx1cmUoe2Vycm9yLCBqb2JJZCwgc3RhZ2V9KSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG4gICAgY29uc3QgcGF5bG9hZCA9IHtjb250ZXh0OiB7Z2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZCwgam9iSWQsIHN0YWdlfSwgZXJyb3I6IG5vcm1hbGl6ZWRFcnJvcn1cbiAgICBjb25zdCBlcnJvckV2ZW50cyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpXG5cbiAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJGYWlsZWQgdG8gdXBkYXRlIGJhY2tncm91bmQgam9iOlwiLCBub3JtYWxpemVkRXJyb3JdKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuICB9XG5cbiAgLyoqXG4gICAqIFBlcnNpc3RzIGEgbm9ybWFsIGpvYiByZXNjaGVkdWxlIG91dGNvbWUgYW5kIHdha2VzIHNjaGVkdWxlZCBkaXNwYXRjaC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJlc2NoZWR1bGVNZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBNZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGhhbmRsZWQuXG4gICAqL1xuICBhc3luYyBfaGFuZGxlSm9iUmVzY2hlZHVsZSh7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgYWNjZXB0ZWQgPSBhd2FpdCB0aGlzLnN0b3JlLm1hcmtSZXNjaGVkdWxlZCh7XG4gICAgICAgIGpvYklkOiBtZXNzYWdlLmpvYklkLFxuICAgICAgICBkZWxheU1zOiBtZXNzYWdlLmRlbGF5TXMsXG4gICAgICAgIGhhbmRvZmZJZDogbWVzc2FnZS5oYW5kb2ZmSWQsXG4gICAgICAgIHdvcmtlcklkOiBtZXNzYWdlLndvcmtlcklkLFxuICAgICAgICBoYW5kZWRPZmZBdE1zOiBtZXNzYWdlLmhhbmRlZE9mZkF0TXNcbiAgICAgIH0pXG4gICAgICBpZiAoYWNjZXB0ZWQgJiYgbWVzc2FnZS5oYW5kb2ZmSWQpIHtcbiAgICAgICAgdGhpcy5fZm9yZ2V0SGFuZG9mZih7aGFuZG9mZklkOiBtZXNzYWdlLmhhbmRvZmZJZCwgam9iSWQ6IG1lc3NhZ2Uuam9iSWR9KVxuICAgICAgfVxuICAgICAgdGhpcy5vbkpvYlVwZGF0ZWQ/Lih7YWNjZXB0ZWQsIGpvYklkOiBtZXNzYWdlLmpvYklkLCBzdGF0dXM6IFwicmVzY2hlZHVsZWRcIn0pXG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiam9iLXVwZGF0ZWRcIiwgam9iSWQ6IG1lc3NhZ2Uuam9iSWR9KVxuICAgICAgdGhpcy5fbm90aWZ5RW5xdWV1ZWQoKVxuICAgICAgYXdhaXQgdGhpcy5fZHJhaW4oKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICAgIGNvbnN0IHBheWxvYWQgPSB7Y29udGV4dDoge2pvYklkOiBtZXNzYWdlLmpvYklkLCBzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi1yZXNjaGVkdWxlXCJ9LCBlcnJvcjogbm9ybWFsaXplZEVycm9yfVxuICAgICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJGYWlsZWQgdG8gdXBkYXRlIGpvYiByZXNjaGVkdWxlOlwiLCBub3JtYWxpemVkRXJyb3JdKVxuICAgICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgICAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4ucGF5bG9hZCwgZXJyb3JUeXBlOiBcImZyYW1ld29yay1lcnJvclwifSlcbiAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJqb2ItdXBkYXRlLWVycm9yXCIsIGpvYklkOiBtZXNzYWdlLmpvYklkLCBlcnJvcjogXCJGYWlsZWQgdG8gdXBkYXRlIGpvYlwifSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgam9iIGZhaWxlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkZhaWxlZE1lc3NhZ2V9IGFyZ3MubWVzc2FnZSAtIE1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gaGFuZGxlZC5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVKb2JGYWlsZWQoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGZhaWxlZEpvYiA9IGF3YWl0IHRoaXMuc3RvcmUubWFya0ZhaWxlZCh7XG4gICAgICAgIGpvYklkOiBtZXNzYWdlLmpvYklkLFxuICAgICAgICBlcnJvcjogbWVzc2FnZS5lcnJvcixcbiAgICAgICAgaGFuZG9mZklkOiBtZXNzYWdlLmhhbmRvZmZJZCxcbiAgICAgICAgd29ya2VySWQ6IG1lc3NhZ2Uud29ya2VySWQsXG4gICAgICAgIGhhbmRlZE9mZkF0TXM6IG1lc3NhZ2UuaGFuZGVkT2ZmQXRNc1xuICAgICAgfSlcblxuICAgICAgaWYgKGZhaWxlZEpvYikge1xuICAgICAgICBpZiAobWVzc2FnZS5oYW5kb2ZmSWQpIHtcbiAgICAgICAgICB0aGlzLl9mb3JnZXRIYW5kb2ZmKHtoYW5kb2ZmSWQ6IG1lc3NhZ2UuaGFuZG9mZklkLCBqb2JJZDogbWVzc2FnZS5qb2JJZH0pXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fZW1pdEJhY2tncm91bmRKb2JGYWlsZWQoe1xuICAgICAgICAgIGVycm9yOiBtZXNzYWdlLmVycm9yLFxuICAgICAgICAgIGhhbmRvZmZJZDogbWVzc2FnZS5oYW5kb2ZmSWQsXG4gICAgICAgICAgaGFuZGVkT2ZmQXRNczogbWVzc2FnZS5oYW5kZWRPZmZBdE1zLFxuICAgICAgICAgIGpvYjogZmFpbGVkSm9iLFxuICAgICAgICAgIHdvcmtlcklkOiBtZXNzYWdlLndvcmtlcklkXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIHRoaXMub25Kb2JVcGRhdGVkPy4oe2FjY2VwdGVkOiBCb29sZWFuKGZhaWxlZEpvYiksIGpvYklkOiBtZXNzYWdlLmpvYklkLCBzdGF0dXM6IFwiZmFpbGVkXCJ9KVxuICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImpvYi11cGRhdGVkXCIsIGpvYklkOiBtZXNzYWdlLmpvYklkfSlcbiAgICAgIC8vIEEgZmFpbGVkIGpvYiBtYXkgaGF2ZSBiZWVuIHJlLXF1ZXVlZCAod2l0aCBiYWNrb2ZmKSBmb3IgcmV0cnkg4oCUXG4gICAgICAvLyBwb2tlIHRoZSBkaXNwYXRjaGVyIHNvIHRoZSByZXRyeSB0aW1lciBpcyBhcm1lZC5cbiAgICAgIHRoaXMuX25vdGlmeUVucXVldWVkKClcbiAgICAgIGF3YWl0IHRoaXMuX2RyYWluKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiRmFpbGVkIHRvIHVwZGF0ZSBqb2IgZmFpbHVyZTpcIiwgZXJyb3JdKVxuICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImpvYi11cGRhdGUtZXJyb3JcIiwgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsIGVycm9yOiBcIkZhaWxlZCB0byB1cGRhdGUgam9iXCJ9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVtaXQgYmFja2dyb3VuZCBqb2IgZmFpbGVkLlxuICAgKiBAcGFyYW0ge3tlcnJvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGhhbmRvZmZJZD86IHN0cmluZywgaGFuZGVkT2ZmQXRNcz86IG51bWJlciwgam9iOiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3csIHdvcmtlcklkPzogc3RyaW5nfX0gYXJncyAtIEZhaWx1cmUgZXZlbnQgZGF0YS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfZW1pdEJhY2tncm91bmRKb2JGYWlsZWQoe2Vycm9yLCBoYW5kb2ZmSWQsIGhhbmRlZE9mZkF0TXMsIGpvYiwgd29ya2VySWR9KSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gdGhpcy5fbm9ybWFsaXplRmFpbHVyZUVycm9yKGVycm9yKVxuICAgIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgICBjb250ZXh0OiB7XG4gICAgICAgIGF0dGVtcHRzOiBqb2IuYXR0ZW1wdHMsXG4gICAgICAgIGhhbmRvZmZJZCxcbiAgICAgICAgaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgam9iQXJnczogam9iLmFyZ3MsXG4gICAgICAgIGpvYklkOiBqb2IuaWQsXG4gICAgICAgIGpvYk5hbWU6IGpvYi5qb2JOYW1lLFxuICAgICAgICBtYXhSZXRyaWVzOiBqb2IubWF4UmV0cmllcyxcbiAgICAgICAgc3RhZ2U6IFwiYmFja2dyb3VuZC1qb2ItZmFpbGVkXCIsXG4gICAgICAgIHN0YXR1czogam9iLnN0YXR1cyxcbiAgICAgICAgdGVybWluYWw6IGpvYi5zdGF0dXMgPT09IFwiZmFpbGVkXCIgfHwgam9iLnN0YXR1cyA9PT0gXCJvcnBoYW5lZFwiLFxuICAgICAgICB3aWxsUmV0cnk6IGpvYi5zdGF0dXMgPT09IFwicXVldWVkXCIsXG4gICAgICAgIHdvcmtlcklkXG4gICAgICB9LFxuICAgICAgZXJyb3I6IG5vcm1hbGl6ZWRFcnJvclxuICAgIH1cbiAgICBjb25zdCBlcnJvckV2ZW50cyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpXG5cbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYmFja2dyb3VuZC1qb2ItZmFpbGVkXCIsIHBheWxvYWQpXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4ucGF5bG9hZCwgZXJyb3JUeXBlOiBcImJhY2tncm91bmQtam9iLWZhaWxlZFwifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBFbWl0cyBgYmFja2dyb3VuZC1qb2Itb3JwaGFuZWRgIChtaXJyb3JlZCB0byBgYWxsLWVycm9yYCkgZm9yIGEgam9iIHRoZSB0aW1lLWJhc2VkIG9ycGhhbiBzd2VlcFxuICAgKiByZWNsYWltZWQgYWZ0ZXIgaXRzIHdvcmtlciBkaWVkIG1pZC1ydW4uIFVubGlrZSBgYmFja2dyb3VuZC1qb2ItZmFpbGVkYCwgd2hpY2ggZmlyZXMgb24gYVxuICAgKiB3b3JrZXIncyBmYWlsdXJlIHJlcG9ydCwgdGhpcyBmaXJlcyBmcm9tIHRoZSBtYWluIHByb2Nlc3MncyBzd2VlcCwgc28gYXBwbGljYXRpb25zIGNhbiByZWFjdCB0b1xuICAgKiBhIGRlYWQgd29ya2VyJ3Mgc3BlY2lmaWMgam9iIOKAlCByZWNvdmVyIHRoZSB3b3JrIGl0IGxlZnQgYmVoaW5kIOKAlCB3aXRob3V0IHBvbGxpbmcuIGB3aWxsUmV0cnlgXG4gICAqIHJlZmxlY3RzIHdoZXRoZXIgdGhlIHJlY2xhaW0gcmV0dXJuZWQgdGhlIGpvYiB0byB0aGUgcXVldWUgZm9yIGFub3RoZXIgYXR0ZW1wdC5cbiAgICogQHBhcmFtIHt7am9iOiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9fSBhcmdzIC0gVGhlIG9ycGhhbmVkIGpvYi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfZW1pdEJhY2tncm91bmRKb2JPcnBoYW5lZCh7am9ifSkge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IHRoaXMuX25vcm1hbGl6ZUZhaWx1cmVFcnJvcihqb2IubGFzdEVycm9yID8/IFwiSm9iIG9ycGhhbmVkIGFmdGVyIHRpbWVvdXRcIilcbiAgICBjb25zdCBwYXlsb2FkID0ge1xuICAgICAgY29udGV4dDoge1xuICAgICAgICBhdHRlbXB0czogam9iLmF0dGVtcHRzLFxuICAgICAgICBqb2JBcmdzOiBqb2IuYXJncyxcbiAgICAgICAgam9iSWQ6IGpvYi5pZCxcbiAgICAgICAgam9iTmFtZTogam9iLmpvYk5hbWUsXG4gICAgICAgIG1heFJldHJpZXM6IGpvYi5tYXhSZXRyaWVzLFxuICAgICAgICBzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi1vcnBoYW5lZFwiLFxuICAgICAgICBzdGF0dXM6IGpvYi5zdGF0dXMsXG4gICAgICAgIHRlcm1pbmFsOiBqb2Iuc3RhdHVzID09PSBcImZhaWxlZFwiIHx8IGpvYi5zdGF0dXMgPT09IFwib3JwaGFuZWRcIixcbiAgICAgICAgd2lsbFJldHJ5OiBqb2Iuc3RhdHVzID09PSBcInF1ZXVlZFwiXG4gICAgICB9LFxuICAgICAgZXJyb3I6IG5vcm1hbGl6ZWRFcnJvclxuICAgIH1cbiAgICBjb25zdCBlcnJvckV2ZW50cyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpXG5cbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYmFja2dyb3VuZC1qb2Itb3JwaGFuZWRcIiwgcGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiYmFja2dyb3VuZC1qb2Itb3JwaGFuZWRcIn0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgZmFpbHVyZSBlcnJvci5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBSZXBvcnRlZCBmYWlsdXJlIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7RXJyb3J9IE5vcm1hbGl6ZWQgZXJyb3IuXG4gICAqL1xuICBfbm9ybWFsaXplRmFpbHVyZUVycm9yKGVycm9yKSB7XG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHJldHVybiBlcnJvclxuXG4gICAgcmV0dXJuIHRoaXMuX2Vycm9yRnJvbVVua25vd25GYWlsdXJlKGVycm9yKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXJyb3IgZnJvbSB1bmtub3duIGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gUmVwb3J0ZWQgZmFpbHVyZSB2YWx1ZS5cbiAgICogQHJldHVybnMge0Vycm9yfSBOb3JtYWxpemVkIGVycm9yLlxuICAgKi9cbiAgX2Vycm9yRnJvbVVua25vd25GYWlsdXJlKGVycm9yKSB7XG4gICAgY29uc3QgbWVzc2FnZSA9IHRoaXMuX21lc3NhZ2VGcm9tVW5rbm93bkZhaWx1cmUoZXJyb3IpXG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gbmV3IEVycm9yKG1lc3NhZ2UpXG5cbiAgICB0aGlzLl9jb3B5U3RyaW5nRmFpbHVyZVN0YWNrKHtlcnJvciwgbm9ybWFsaXplZEVycm9yfSlcblxuICAgIHJldHVybiBub3JtYWxpemVkRXJyb3JcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1lc3NhZ2UgZnJvbSB1bmtub3duIGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gUmVwb3J0ZWQgZmFpbHVyZSB2YWx1ZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gRXJyb3IgbWVzc2FnZS5cbiAgICovXG4gIF9tZXNzYWdlRnJvbVVua25vd25GYWlsdXJlKGVycm9yKSB7XG4gICAgaWYgKHRoaXMuX2hhc1N0cmluZ0ZhaWx1cmUoZXJyb3IpKSByZXR1cm4gZXJyb3IudHJpbSgpLnNwbGl0KFwiXFxuXCIpWzBdXG5cbiAgICByZXR1cm4gU3RyaW5nKGVycm9yIHx8IFwiQmFja2dyb3VuZCBqb2IgZmFpbGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYXMgc3RyaW5nIGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gUmVwb3J0ZWQgZmFpbHVyZSB2YWx1ZS5cbiAgICogQHJldHVybnMge2Vycm9yIGlzIHN0cmluZ30gV2hldGhlciB0aGUgdmFsdWUgaXMgYSBub24tZW1wdHkgc3RyaW5nLlxuICAgKi9cbiAgX2hhc1N0cmluZ0ZhaWx1cmUoZXJyb3IpIHtcbiAgICByZXR1cm4gdHlwZW9mIGVycm9yID09PSBcInN0cmluZ1wiICYmIGVycm9yLnRyaW0oKS5sZW5ndGggPiAwXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb3B5IHN0cmluZyBmYWlsdXJlIHN0YWNrLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuZXJyb3IgLSBSZXBvcnRlZCBmYWlsdXJlIHZhbHVlLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBhcmdzLm5vcm1hbGl6ZWRFcnJvciAtIE5vcm1hbGl6ZWQgZXJyb3IuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2NvcHlTdHJpbmdGYWlsdXJlU3RhY2soe2Vycm9yLCBub3JtYWxpemVkRXJyb3J9KSB7XG4gICAgaWYgKHRoaXMuX2hhc1N0cmluZ0ZhaWx1cmUoZXJyb3IpKSBub3JtYWxpemVkRXJyb3Iuc3RhY2sgPSBlcnJvclxuICB9XG5cbiAgLyoqXG4gICAqIERyYWlucyBhbGwgZGlzcGF0Y2hhYmxlIGpvYnMgdG8gcmVhZHkgd29ya2VycywgdGhlbiBhcm1zIHRoZVxuICAgKiBzY2hlZHVsZWQtam9iIHRpbWVyIGZvciB0aGUgbmV4dCBmdXR1cmUgYHNjaGVkdWxlZF9hdF9tc2AuIENvYWxlc2Nlc1xuICAgKiBjb25jdXJyZW50IHRyaWdnZXJzOiBhIHdha2UtdXAgdGhhdCBsYW5kcyB3aGlsZSBhIGRyYWluIGlzIGluXG4gICAqIGZsaWdodCBqdXN0IHNldHMgYSByZS1kcmFpbiBmbGFnIGFuZCBsZXRzIHRoZSBpbi1mbGlnaHQgZHJhaW5cbiAgICogcmUtbG9vcCBhZnRlciBpdCBmaW5pc2hlcywgc28gbm8gc2lnbmFsIGlzIGRyb3BwZWQgYnV0IG5vIHR3b1xuICAgKiBkcmFpbnMgcnVuIGluIHBhcmFsbGVsLlxuICAgKlxuICAgKiBSZXNpbGllbmNlOiBpbiBiZWFjb24gbW9kZSB0aGlzIGlzIHRoZSBzb2xlIHdha2UtdXAgcGF0aCBmb3JcbiAgICogYWxyZWFkeS1xdWV1ZWQgd29yaywgc28gYSB0cmFuc2llbnQgREIgZXJyb3IgZHVyaW5nIHRoZSBkcmFpbiAoZS5nLlxuICAgKiBgbmV4dEF2YWlsYWJsZUpvYigpYCByZWplY3RpbmcpIG11c3Qgbm90IHN0cmFuZCB0aGUgcXVldWUgdW50aWwgdGhlXG4gICAqIG5leHQgZXh0ZXJuYWwgc2lnbmFsLiBPbiBhbnkgZXJyb3Igd2UgbG9nIGl0IGFuZCBhcm0gYSBvbmUtc2hvdFxuICAgKiByZXRyeSB2aWEgYF9zY2hlZHVsZUVycm9yUmV0cnlgIHVzaW5nIGBwb2xsSW50ZXJ2YWxNc2AgYXMgdGhlXG4gICAqIGNhZGVuY2U7IG9uIHN1Y2Nlc3MgdGhlIHJldHJ5IHRpbWVyIGlzIGNsZWFyZWQuIFBvbGxpbmctbW9kZSBydW5zXG4gICAqIGBfZHJhaW5gIGZyb20gaXRzIG93biBpbnRlcnZhbCwgc28gdGhlIHJldHJ5IHRpbWVyIGlzIGEgbm8tb3AgdGhlcmUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2RyYWluKCkge1xuICAgIGlmICh0aGlzLl9zdG9wcGVkIHx8IHRoaXMubGlmZWN5Y2xlU3RhdGUgIT09IFwiYWN0aXZlXCIgfHwgIXRoaXMuX2FjdGl2ZU93bmVyc2hpcFJlYWR5KSByZXR1cm5cblxuICAgIGlmICh0aGlzLl9kcmFpblByb21pc2UpIHtcbiAgICAgIHRoaXMuX3JlZHJhaW5RdWV1ZWQgPSB0cnVlXG4gICAgICBhd2FpdCB0aGlzLl9kcmFpblByb21pc2VcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IGRyYWluUHJvbWlzZSA9IHRoaXMuX2RyYWluVG9Db21wbGV0aW9uKClcblxuICAgIHRoaXMuX2RyYWluUHJvbWlzZSA9IGRyYWluUHJvbWlzZVxuICAgIGF3YWl0IGRyYWluUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb25lIHNlcmlhbGl6ZWQgZHJhaW4gbGlmZWN5Y2xlLCBpbmNsdWRpbmcgdGltZXIgcmUtYXJtaW5nLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBldmVyeSBjb2FsZXNjZWQgcmVxdWVzdCBpcyBoYW5kbGVkLlxuICAgKi9cbiAgYXN5bmMgX2RyYWluVG9Db21wbGV0aW9uKCkge1xuICAgIHRoaXMuX2RyYWluaW5nID0gdHJ1ZVxuXG4gICAgdHJ5IHtcbiAgICAgIGxldCBlcnJvcmVkXG5cbiAgICAgIGRvIHtcbiAgICAgICAgZXJyb3JlZCA9IGF3YWl0IHRoaXMuX2RyYWluVW50aWxJZGxlKClcbiAgICAgICAgYXdhaXQgdGhpcy5fZmluaXNoRHJhaW4oe2Vycm9yZWR9KVxuICAgICAgfSB3aGlsZSAoIWVycm9yZWQgJiYgdGhpcy5fcmVkcmFpblF1ZXVlZCAmJiAhdGhpcy5fc3RvcHBlZCAmJiB0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcImFjdGl2ZVwiKVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl9kcmFpbmluZyA9IGZhbHNlXG4gICAgICB0aGlzLl9kcmFpblByb21pc2UgPSB1bmRlZmluZWRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5pc2ggZHJhaW4uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLmVycm9yZWQgLSBXaGV0aGVyIHRoZSBkcmFpbiBoaXQgYW4gZXJyb3IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGZvbGxvdy11cCB0aW1lcnMgYXJlIGhhbmRsZWQuXG4gICAqL1xuICBhc3luYyBfZmluaXNoRHJhaW4oe2Vycm9yZWR9KSB7XG4gICAgaWYgKHRoaXMuX3N0b3BwZWQgfHwgdGhpcy5saWZlY3ljbGVTdGF0ZSAhPT0gXCJhY3RpdmVcIikgcmV0dXJuXG4gICAgaWYgKGVycm9yZWQpIHJldHVybiB0aGlzLl9zY2hlZHVsZUVycm9yUmV0cnkoKVxuXG4gICAgYXdhaXQgdGhpcy5fYXJtU2NoZWR1bGVkVGltZXJPclJldHJ5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFybSBzY2hlZHVsZWQgdGltZXIgb3IgcmV0cnkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHNjaGVkdWxlZCB0aW1lciBoYW5kbGluZy5cbiAgICovXG4gIGFzeW5jIF9hcm1TY2hlZHVsZWRUaW1lck9yUmV0cnkoKSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX2FybVNjaGVkdWxlZFRpbWVyKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiQmFja2dyb3VuZCBqb2JzIHNjaGVkdWxlZC10aW1lciBhcm1pbmcgZmFpbGVkOlwiLCBlcnJvcl0pXG4gICAgICB0aGlzLl9zY2hlZHVsZUVycm9yUmV0cnkoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5fY2xlYXJFcnJvclJldHJ5VGltZXIoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xlYXIgZXJyb3IgcmV0cnkgdGltZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAqL1xuICBfY2xlYXJFcnJvclJldHJ5VGltZXIoKSB7XG4gICAgaWYgKHRoaXMucGVuZGluZ0hhbmRvZmZSZWNvdmVyaWVzLnNpemUgPiAwKSByZXR1cm5cbiAgICBpZiAodGhpcy5fc3RhcnR1cEhhbmRvZmZHcmFjZUVsYXBzZWQgJiYgdGhpcy5zdGFydHVwSGFuZG9mZlNuYXBzaG90Lmxlbmd0aCA+IDApIHJldHVyblxuXG4gICAgZm9yIChjb25zdCB3b3JrZXIgb2YgdGhpcy53b3JrZXJIYW5kb2Zmcy5rZXlzKCkpIHtcbiAgICAgIGlmICghdGhpcy53b3JrZXJzLmhhcyh3b3JrZXIpKSByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAodGhpcy5fZXJyb3JSZXRyeVRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5fZXJyb3JSZXRyeVRpbWVyKVxuICAgICAgdGhpcy5fZXJyb3JSZXRyeVRpbWVyID0gdW5kZWZpbmVkXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZHJhaW4gdW50aWwgaWRsZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgZHJhaW4gaGl0IGFuIGVycm9yLlxuICAgKi9cbiAgYXN5bmMgX2RyYWluVW50aWxJZGxlKCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9ydW5EcmFpbkxvb3AoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIGRyYWluIGxvb3AuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGRyYWluIGhpdCBhbiBlcnJvci5cbiAgICovXG4gIGFzeW5jIF9ydW5EcmFpbkxvb3AoKSB7XG4gICAgZG8ge1xuICAgICAgdGhpcy5fcmVkcmFpblF1ZXVlZCA9IGZhbHNlXG4gICAgICBjb25zdCBlcnJvcmVkID0gYXdhaXQgdGhpcy5fZHJhaW5PbmNlV2l0aEVycm9yUmVwb3J0KClcblxuICAgICAgaWYgKGVycm9yZWQpIHJldHVybiB0cnVlXG4gICAgfSB3aGlsZSAodGhpcy5fcmVkcmFpblF1ZXVlZCAmJiAhdGhpcy5fc3RvcHBlZClcblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZHJhaW4gb25jZSB3aXRoIGVycm9yIHJlcG9ydC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBvbmUgZHJhaW4gcGFzcyBmYWlsZWQuXG4gICAqL1xuICBhc3luYyBfZHJhaW5PbmNlV2l0aEVycm9yUmVwb3J0KCkge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl9kcmFpbk9uY2UoKVxuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIkJhY2tncm91bmQgam9icyBkcmFpbiBmYWlsZWQ6XCIsIGVycm9yXSlcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFybXMgYSBvbmUtc2hvdCBgc2V0VGltZW91dGAgdG8gcmV0cnkgYF9kcmFpbmAgYWZ0ZXIgYSB0cmFuc2llbnRcbiAgICogZmFpbHVyZS4gSWRlbXBvdGVudCDigJQgcmVwZWF0ZWQgY2FsbHMgd2hpbGUgYSByZXRyeSBpcyBhbHJlYWR5XG4gICAqIHBlbmRpbmcgYXJlIG5vLW9wcy4gUG9sbGluZyBtb2RlIGFscmVhZHkgcmV0cmllcyB2aWEgaXRzIG93blxuICAgKiBpbnRlcnZhbCwgc28gdGhpcyBpcyBhIG5vLW9wIGluIHRoYXQgbW9kZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2NoZWR1bGVFcnJvclJldHJ5KCkge1xuICAgIGlmICh0aGlzLl9zdG9wcGVkKSByZXR1cm5cbiAgICBpZiAodGhpcy5fZXJyb3JSZXRyeVRpbWVyKSByZXR1cm5cbiAgICBpZiAodGhpcy5kaXNwYXRjaFN0cmF0ZWd5ID09PSBcInBvbGxpbmdcIiAmJiB0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcImFjdGl2ZVwiKSByZXR1cm5cblxuICAgIHRoaXMuX2Vycm9yUmV0cnlUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdGhpcy5fZXJyb3JSZXRyeVRpbWVyID0gdW5kZWZpbmVkXG4gICAgICB2b2lkIHRoaXMuX3JldHJ5QWZ0ZXJFcnJvcigpXG4gICAgfSwgdGhpcy5wb2xsSW50ZXJ2YWxNcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXRyaWVzIGZhaWxlZCBwcmUtZGlzcGF0Y2ggYW5kIGRpc2Nvbm5lY3RlZC1zb2NrZXQgcmVsZWFzZXMgYmVmb3JlXG4gICAqIGRyYWluaW5nIHF1ZXVlZCB3b3JrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciByZXRyeSB3b3JrLlxuICAgKi9cbiAgYXN5bmMgX3JldHJ5QWZ0ZXJFcnJvcigpIHtcbiAgICBpZiAodGhpcy5fc3RvcHBlZCkgcmV0dXJuXG5cbiAgICBpZiAodGhpcy5fc3RhcnR1cEhhbmRvZmZHcmFjZUVsYXBzZWQgJiYgdGhpcy5zdGFydHVwSGFuZG9mZlNuYXBzaG90Lmxlbmd0aCA+IDApIHtcbiAgICAgIGF3YWl0IHRoaXMuX3N0YXJ0U3RhcnR1cEhhbmRvZmZSZWNsYWltKClcbiAgICAgIGlmICh0aGlzLnN0YXJ0dXBIYW5kb2ZmU25hcHNob3QubGVuZ3RoID4gMCkgcmV0dXJuXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX3JldHJ5UGVuZGluZ0hhbmRvZmZSZWNvdmVyaWVzKClcbiAgICB9IGNhdGNoIHtcbiAgICAgIHRoaXMuX3NjaGVkdWxlRXJyb3JSZXRyeSgpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgZm9yIChjb25zdCB3b3JrZXIgb2YgdGhpcy53b3JrZXJIYW5kb2Zmcy5rZXlzKCkpIHtcbiAgICAgICAgaWYgKCF0aGlzLndvcmtlcnMuaGFzKHdvcmtlcikpIGF3YWl0IHRoaXMuX3JlbGVhc2VXb3JrZXJIYW5kb2Zmcyh3b3JrZXIpXG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuX3JlcG9ydEhhbmRvZmZSZWxlYXNlRXJyb3IoZXJyb3IpXG4gICAgICB0aGlzLl9zY2hlZHVsZUVycm9yUmV0cnkoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwiYWN0aXZlXCIpIGF3YWl0IHRoaXMuX2RyYWluKClcbiAgICB0aGlzLl9tYXliZVN0b3BSZXRpcmVkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBJbm5lciBkcmFpbiBsb29wOiBwdWxscyBlbGlnaWJsZSBxdWV1ZWQgam9icyBhbmQgaGFuZHMgdGhlbSBvZmYgdG9cbiAgICogcmVhZHkgd29ya2VycyB1bnRpbCBvbmUgb2YgdGhlbSBydW5zIG91dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfZHJhaW5PbmNlKCkge1xuICAgIHdoaWxlICh0aGlzLnJlYWR5V29ya2Vycy5zaXplID4gMCAmJiAhdGhpcy5fc3RvcHBlZCAmJiB0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcImFjdGl2ZVwiICYmIHRoaXMuX2FjdGl2ZU93bmVyc2hpcFJlYWR5KSB7XG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLm5leHRBdmFpbGFibGVKb2JGb3JSZWFkeVdvcmtlcnMoKVxuICAgICAgaWYgKCFqb2IpIHJldHVyblxuXG4gICAgICBjb25zdCB3b3JrZXIgPSB0aGlzLnJlYWR5V29ya2VyRm9ySm9iKGpvYilcbiAgICAgIGlmICghd29ya2VyKSByZXR1cm5cblxuICAgICAgY29uc3QgYWRtaXNzaW9uID0gdGhpcy5fY29uc3VtZVdvcmtlckFkbWlzc2lvbih7am9iLCB3b3JrZXJ9KVxuICAgICAgY29uc3QgcmVxdWVzdGVkSGFuZG9mZklkID0gcmFuZG9tVVVJRCgpXG4gICAgICBsZXQgaGFuZG9mZlxuXG4gICAgICB0cnkge1xuICAgICAgICBoYW5kb2ZmID0gYXdhaXQgdGhpcy5zdG9yZS5tYXJrSGFuZGVkT2ZmKHtoYW5kb2ZmSWQ6IHJlcXVlc3RlZEhhbmRvZmZJZCwgam9iSWQ6IGpvYi5pZCwgd29ya2VySWQ6IHdvcmtlci53b3JrZXJJZH0pXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aGlzLl9yZW1lbWJlckhhbmRvZmZSZWNvdmVyeSh7aGFuZG9mZklkOiByZXF1ZXN0ZWRIYW5kb2ZmSWQsIGpvYklkOiBqb2IuaWR9KVxuICAgICAgICB0aGlzLl9yZXN0b3JlV29ya2VyQWRtaXNzaW9uKHsuLi5hZG1pc3Npb24sIHdvcmtlcn0pXG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLl9yZWNvdmVySGFuZG9mZih7aGFuZG9mZklkOiByZXF1ZXN0ZWRIYW5kb2ZmSWQsIGpvYklkOiBqb2IuaWR9KVxuICAgICAgICB9IGNhdGNoIChyZWNvdmVyeUVycm9yKSB7XG4gICAgICAgICAgdGhpcy5fcmVwb3J0SGFuZG9mZlJlY292ZXJ5RXJyb3Ioe2Vycm9yOiByZWNvdmVyeUVycm9yLCBoYW5kb2ZmSWQ6IHJlcXVlc3RlZEhhbmRvZmZJZCwgam9iSWQ6IGpvYi5pZH0pXG4gICAgICAgIH1cblxuICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgfVxuXG4gICAgICBpZiAoIWhhbmRvZmYpIHtcbiAgICAgICAgdGhpcy5fcmVzdG9yZVdvcmtlckFkbWlzc2lvbih7Li4uYWRtaXNzaW9uLCB3b3JrZXJ9KVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLmFmdGVySGFuZG9mZkNsYWltPy4oe2hhbmRvZmYsIGpvYn0pXG5cbiAgICAgIGNvbnN0IGhhbmRvZmZzID0gdGhpcy53b3JrZXJIYW5kb2Zmcy5nZXQod29ya2VyKVxuXG4gICAgICBpZiAoIWhhbmRvZmZzIHx8ICF0aGlzLndvcmtlcnMuaGFzKHdvcmtlcikgfHwgd29ya2VyLmlzRHJhaW5pbmcgfHwgdGhpcy5saWZlY3ljbGVTdGF0ZSAhPT0gXCJhY3RpdmVcIiB8fCAhdGhpcy5fYWN0aXZlT3duZXJzaGlwUmVhZHkpIHtcbiAgICAgICAgdGhpcy5fcmVtZW1iZXJIYW5kb2ZmUmVjb3Zlcnkoe2hhbmRvZmZJZDogaGFuZG9mZi5oYW5kb2ZmSWQsIGpvYklkOiBqb2IuaWR9KVxuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IHRoaXMuX3JlY292ZXJIYW5kb2ZmKHtoYW5kb2ZmSWQ6IGhhbmRvZmYuaGFuZG9mZklkLCBqb2JJZDogam9iLmlkfSlcbiAgICAgICAgfSBjYXRjaCAocmVjb3ZlcnlFcnJvcikge1xuICAgICAgICAgIHRoaXMuX3JlcG9ydEhhbmRvZmZSZWNvdmVyeUVycm9yKHtlcnJvcjogcmVjb3ZlcnlFcnJvciwgaGFuZG9mZklkOiBoYW5kb2ZmLmhhbmRvZmZJZCwgam9iSWQ6IGpvYi5pZH0pXG4gICAgICAgICAgdGhyb3cgcmVjb3ZlcnlFcnJvclxuICAgICAgICB9XG4gICAgICAgIHRoaXMuX25vdGlmeUVucXVldWVkKClcbiAgICAgICAgdGhpcy5fcmVkcmFpblF1ZXVlZCA9IHRydWVcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgdGhpcy5fZmluYWxpemVXb3JrZXJBZG1pc3Npb24oey4uLmFkbWlzc2lvbiwgam9iLCB3b3JrZXJ9KVxuICAgICAgaGFuZG9mZnMuc2V0KGpvYi5pZCwgaGFuZG9mZi5oYW5kb2ZmSWQpXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIHdvcmtlci5zZW5kKHtcbiAgICAgICAgICB0eXBlOiBcImpvYlwiLFxuICAgICAgICAgIHBheWxvYWQ6IHtcbiAgICAgICAgICAgIGlkOiBqb2IuaWQsXG4gICAgICAgICAgICBqb2JOYW1lOiBqb2Iuam9iTmFtZSxcbiAgICAgICAgICAgIGFyZ3M6IGpvYi5hcmdzLFxuICAgICAgICAgICAgaGFuZG9mZklkOiBoYW5kb2ZmLmhhbmRvZmZJZCxcbiAgICAgICAgICAgIHdvcmtlcklkOiB3b3JrZXIud29ya2VySWQsXG4gICAgICAgICAgICBoYW5kZWRPZmZBdE1zOiBoYW5kb2ZmLmhhbmRlZE9mZkF0TXMsXG4gICAgICAgICAgICBvcHRpb25zOiB7XG4gICAgICAgICAgICAgIGNvbmN1cnJlbmN5S2V5OiBqb2IuY29uY3VycmVuY3lLZXkgfHwgdW5kZWZpbmVkLFxuICAgICAgICAgICAgICBleGVjdXRpb25Nb2RlOiBqb2IuZXhlY3V0aW9uTW9kZSxcbiAgICAgICAgICAgICAgbWF4Q29uY3VycmVuY3k6IGpvYi5tYXhDb25jdXJyZW5jeSA/PyB1bmRlZmluZWQsXG4gICAgICAgICAgICAgIG1heFJldHJpZXM6IGpvYi5tYXhSZXRyaWVzID8/IHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgcXVldWU6IGpvYi5xdWV1ZSxcbiAgICAgICAgICAgICAgc2NoZWR1bGVkQXRNczogam9iLnNjaGVkdWxlZEF0TXMgPz8gdW5kZWZpbmVkLFxuICAgICAgICAgICAgICAuLi4oam9iLnRpbWVvdXRNcyA9PT0gbnVsbCA/IHt9IDoge3RpbWVvdXRNczogam9iLnRpbWVvdXRNc30pXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9KVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIud2FybigoKSA9PiBbXCJGYWlsZWQgdG8gc2VuZCBqb2IgdG8gd29ya2VyLCByZS1xdWV1ZWluZzpcIiwgZXJyb3JdKVxuICAgICAgICB0cnkge1xuICAgICAgICAgIHdvcmtlci5jbG9zZSgpXG4gICAgICAgIH0gY2F0Y2ggKGNsb3NlRXJyb3IpIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKCgpID0+IFtcIkZhaWxlZCB0byBjbG9zZSB3b3JrZXIgYWZ0ZXIgam9iIHNlbmQgZmFpbHVyZTpcIiwgY2xvc2VFcnJvcl0pXG4gICAgICAgIH1cbiAgICAgICAgYXdhaXQgdGhpcy5faGFuZGxlV29ya2VyU29ja2V0Q2xvc2VkKHdvcmtlciwge3F1ZXVlUmVkcmFpbjogdHJ1ZX0pXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENvbnN1bWVzIG9uZSBhZHZlcnRpc2VkIHdvcmtlciBhZG1pc3Npb24gd2hpbGUgcGVyc2lzdGVuY2UgaXMgaW4gZmxpZ2h0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFkbWlzc2lvbiBkZXRhaWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gYXJncy5qb2IgLSBTZWxlY3RlZCBqb2IuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy53b3JrZXIgLSBTZWxlY3RlZCB3b3JrZXIgc29ja2V0LlxuICAgKiBAcmV0dXJucyB7e3Bvb2xlZENyZWRpdENvbnN1bWVkOiBib29sZWFuLCByZWFkaW5lc3NWZXJzaW9uOiBudW1iZXJ9fSAtIFJldmVyc2libGUgYWRtaXNzaW9uIGRlYml0LlxuICAgKi9cbiAgX2NvbnN1bWVXb3JrZXJBZG1pc3Npb24oe2pvYiwgd29ya2VyfSkge1xuICAgIGxldCBwb29sZWRDcmVkaXRDb25zdW1lZCA9IGZhbHNlXG5cbiAgICB0aGlzLnJlYWR5V29ya2Vycy5kZWxldGUod29ya2VyKVxuXG4gICAgaWYgKGpvYi5leGVjdXRpb25Nb2RlID09PSBcInBvb2xlZFwiICYmIHdvcmtlci51c2VzUG9vbGVkQ2FwYWNpdHlDcmVkaXRzICYmIHdvcmtlci5hdmFpbGFibGVQb29sZWRTbG90cyA+IDApIHtcbiAgICAgIHBvb2xlZENyZWRpdENvbnN1bWVkID0gdHJ1ZVxuICAgICAgd29ya2VyLmF2YWlsYWJsZVBvb2xlZFNsb3RzIC09IDFcbiAgICAgIGlmICh3b3JrZXIuYXZhaWxhYmxlUG9vbGVkU2xvdHMgPiAwKSB0aGlzLnJlYWR5V29ya2Vycy5hZGQod29ya2VyKVxuICAgIH1cblxuICAgIHJldHVybiB7cG9vbGVkQ3JlZGl0Q29uc3VtZWQsIHJlYWRpbmVzc1ZlcnNpb246IHdvcmtlci5yZWFkaW5lc3NWZXJzaW9ufVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc3RvcmVzIGFuIGFkbWlzc2lvbiB0aGF0IG5ldmVyIHJlYWNoZWQgYSB3b3JrZXIuIEEgbmV3ZXIgcmVhZGluZXNzXG4gICAqIGFkdmVydGlzZW1lbnQgaXMgYWxyZWFkeSBhdXRob3JpdGF0aXZlLCBzbyBpdHMgcG9vbGVkIGNvdW50IGlzIG5vdCBjaGFuZ2VkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFkbWlzc2lvbiBkZXRhaWxzLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MucG9vbGVkQ3JlZGl0Q29uc3VtZWQgLSBXaGV0aGVyIGEgcG9vbGVkIGNyZWRpdCB3YXMgZGViaXRlZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MucmVhZGluZXNzVmVyc2lvbiAtIFJlYWRpbmVzcyBnZW5lcmF0aW9uIGF0IGRlYml0IHRpbWUuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy53b3JrZXIgLSBTZWxlY3RlZCB3b3JrZXIgc29ja2V0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXN0b3JlV29ya2VyQWRtaXNzaW9uKHtwb29sZWRDcmVkaXRDb25zdW1lZCwgcmVhZGluZXNzVmVyc2lvbiwgd29ya2VyfSkge1xuICAgIGlmICh0aGlzLl9zdG9wcGVkIHx8IHRoaXMubGlmZWN5Y2xlU3RhdGUgIT09IFwiYWN0aXZlXCIgfHwgIXRoaXMuX2FjdGl2ZU93bmVyc2hpcFJlYWR5IHx8ICF0aGlzLndvcmtlcnMuaGFzKHdvcmtlcikgfHwgd29ya2VyLmlzRHJhaW5pbmcpIHJldHVyblxuXG4gICAgaWYgKHBvb2xlZENyZWRpdENvbnN1bWVkICYmIHdvcmtlci5yZWFkaW5lc3NWZXJzaW9uID09PSByZWFkaW5lc3NWZXJzaW9uKSB7XG4gICAgICB3b3JrZXIuYXZhaWxhYmxlUG9vbGVkU2xvdHMgKz0gMVxuICAgIH1cblxuICAgIGlmICh3b3JrZXIuc3VwcG9ydHNIYW5kb2ZmSWRSZXBvcnRpbmcpIHRoaXMucmVhZHlXb3JrZXJzLmFkZCh3b3JrZXIpXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBhIHN1Y2Nlc3NmdWwgcG9vbGVkIGFkbWlzc2lvbiB0byBhIHJlYWRpbmVzcyBhZHZlcnRpc2VtZW50IHRoYXRcbiAgICogYXJyaXZlZCB3aGlsZSBwZXJzaXN0ZW5jZSB3YXMgaW4gZmxpZ2h0IGFuZCByZXBsYWNlZCB0aGUgZWFybGllciBkZWJpdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBZG1pc3Npb24gZGV0YWlscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGFyZ3Muam9iIC0gU2VsZWN0ZWQgam9iLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MucG9vbGVkQ3JlZGl0Q29uc3VtZWQgLSBXaGV0aGVyIGEgcG9vbGVkIGNyZWRpdCB3YXMgZGViaXRlZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MucmVhZGluZXNzVmVyc2lvbiAtIFJlYWRpbmVzcyBnZW5lcmF0aW9uIGF0IGRlYml0IHRpbWUuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy53b3JrZXIgLSBTZWxlY3RlZCB3b3JrZXIgc29ja2V0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9maW5hbGl6ZVdvcmtlckFkbWlzc2lvbih7am9iLCBwb29sZWRDcmVkaXRDb25zdW1lZCwgcmVhZGluZXNzVmVyc2lvbiwgd29ya2VyfSkge1xuICAgIGlmICghcG9vbGVkQ3JlZGl0Q29uc3VtZWQgfHwgam9iLmV4ZWN1dGlvbk1vZGUgIT09IFwicG9vbGVkXCIpIHJldHVyblxuICAgIGlmICh3b3JrZXIucmVhZGluZXNzVmVyc2lvbiA9PT0gcmVhZGluZXNzVmVyc2lvbiB8fCAhd29ya2VyLnVzZXNQb29sZWRDYXBhY2l0eUNyZWRpdHMpIHJldHVyblxuICAgIGlmICh3b3JrZXIuYXZhaWxhYmxlUG9vbGVkU2xvdHMgPD0gMCkgcmV0dXJuXG5cbiAgICB3b3JrZXIuYXZhaWxhYmxlUG9vbGVkU2xvdHMgLT0gMVxuICAgIGlmICh3b3JrZXIuYXZhaWxhYmxlUG9vbGVkU2xvdHMgPT09IDApIHRoaXMucmVhZHlXb3JrZXJzLmRlbGV0ZSh3b3JrZXIpXG4gIH1cblxuICAvKipcbiAgICogUmV0YWlucyBhbiBleGFjdCBsZWFzZSBmb3IgaWRlbXBvdGVudCBwcmUtZGlzcGF0Y2ggcmVjb3ZlcnkuXG4gICAqIEBwYXJhbSB7e2hhbmRvZmZJZDogc3RyaW5nLCBqb2JJZDogc3RyaW5nfX0gYXJncyAtIEV4YWN0IHJlY292ZXJ5IGZlbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZW1lbWJlckhhbmRvZmZSZWNvdmVyeSh7aGFuZG9mZklkLCBqb2JJZH0pIHtcbiAgICB0aGlzLnBlbmRpbmdIYW5kb2ZmUmVjb3Zlcmllcy5zZXQoaGFuZG9mZklkLCBqb2JJZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIG9uZSBleGFjdCBsZWFzZSBhbmQgZm9yZ2V0cyBpdCBvbmx5IGFmdGVyIHRoZSBhZGFwdGVyIGFja25vd2xlZGdlc1xuICAgKiB0aGUgZmVuY2VkIHRyYW5zaXRpb24gb3IgY29uZmlybXMgaXQgd2FzIGFscmVhZHkgYWJzZW50LlxuICAgKiBAcGFyYW0ge3toYW5kb2ZmSWQ6IHN0cmluZywgam9iSWQ6IHN0cmluZ319IGFyZ3MgLSBFeGFjdCByZWNvdmVyeSBmZW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZHVyYWJsZSByZWNvdmVyeSBzZXR0bGVzLlxuICAgKi9cbiAgYXN5bmMgX3JlY292ZXJIYW5kb2ZmKHtoYW5kb2ZmSWQsIGpvYklkfSkge1xuICAgIGF3YWl0IHRoaXMuc3RvcmUubWFya1JldHVybmVkVG9RdWV1ZSh7aGFuZG9mZklkLCBqb2JJZH0pXG5cbiAgICBpZiAodGhpcy5wZW5kaW5nSGFuZG9mZlJlY292ZXJpZXMuZ2V0KGhhbmRvZmZJZCkgPT09IGpvYklkKSB7XG4gICAgICB0aGlzLnBlbmRpbmdIYW5kb2ZmUmVjb3Zlcmllcy5kZWxldGUoaGFuZG9mZklkKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBsYXlzIHJldGFpbmVkIGV4YWN0LUlEIHJlY292ZXJpZXMgdGhyb3VnaCB0aGUgZGlzcGF0Y2hlcidzIGV4aXN0aW5nXG4gICAqIHRyYW5zaWVudC1lcnJvciByZXRyeSBsaWZlY3ljbGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGV2ZXJ5IHJldGFpbmVkIHJlY292ZXJ5IHNldHRsZXMuXG4gICAqL1xuICBhc3luYyBfcmV0cnlQZW5kaW5nSGFuZG9mZlJlY292ZXJpZXMoKSB7XG4gICAgZm9yIChjb25zdCBbaGFuZG9mZklkLCBqb2JJZF0gb2YgWy4uLnRoaXMucGVuZGluZ0hhbmRvZmZSZWNvdmVyaWVzXSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5fcmVjb3ZlckhhbmRvZmYoe2hhbmRvZmZJZCwgam9iSWR9KVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5fcmVwb3J0SGFuZG9mZlJlY292ZXJ5RXJyb3Ioe2Vycm9yLCBoYW5kb2ZmSWQsIGpvYklkfSlcbiAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU3VyZmFjZXMgYSBmYWlsZWQgZXhhY3QtSUQgcmVjb3Zlcnkgd2l0aG91dCBkcm9wcGluZyBpdHMgcmV0cnkgbGVkZ2VyIGVudHJ5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJlY292ZXJ5IGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuZXJyb3IgLSBBZGFwdGVyIGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmhhbmRvZmZJZCAtIEV4YWN0IGxlYXNlIGZlbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVwb3J0SGFuZG9mZlJlY292ZXJ5RXJyb3Ioe2Vycm9yLCBoYW5kb2ZmSWQsIGpvYklkfSkge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKVxuICAgIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgICBjb250ZXh0OiB7aGFuZG9mZklkLCBqb2JJZCwgc3RhZ2U6IFwiYmFja2dyb3VuZC1qb2ItaGFuZG9mZi1hZG1pc3Npb24tcmVjb3ZlcnlcIn0sXG4gICAgICBlcnJvcjogbm9ybWFsaXplZEVycm9yXG4gICAgfVxuICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIkZhaWxlZCB0byByZWNvdmVyIGFuIGFtYmlndW91cyBiYWNrZ3JvdW5kIGpvYiBoYW5kb2ZmOlwiLCBub3JtYWxpemVkRXJyb3JdKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbmV4dCBhdmFpbGFibGUgam9iIGZvciByZWFkeSB3b3JrZXJzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBOZXh0IHF1ZXVlZCBqb2IgbWF0Y2hpbmcgcmVhZHkgd29ya2VyIGNhcGFjaXR5LlxuICAgKi9cbiAgYXN5bmMgbmV4dEF2YWlsYWJsZUpvYkZvclJlYWR5V29ya2VycygpIHtcbiAgICBjb25zdCBleGVjdXRpb25Nb2RlcyA9IHRoaXMucmVhZHlXb3JrZXJFeGVjdXRpb25Nb2RlcygpXG5cbiAgICBpZiAoZXhlY3V0aW9uTW9kZXMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbFxuICAgIGlmIChleGVjdXRpb25Nb2Rlcy5sZW5ndGggPT09IFdPUktFUl9FWEVDVVRJT05fTU9ERV9DQVBBQklMSVRJRVMubGVuZ3RoKSByZXR1cm4gYXdhaXQgdGhpcy5zdG9yZS5uZXh0QXZhaWxhYmxlSm9iKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLnN0b3JlLm5leHRBdmFpbGFibGVKb2Ioe2V4ZWN1dGlvbk1vZGU6IGV4ZWN1dGlvbk1vZGVzfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlYWR5IHdvcmtlciBleGVjdXRpb24gbW9kZXMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlW119IC0gRXhlY3V0aW9uIG1vZGVzIGN1cnJlbnRseSBhY2NlcHRlZCBieSByZWFkeSB3b3JrZXJzLlxuICAgKi9cbiAgcmVhZHlXb3JrZXJFeGVjdXRpb25Nb2RlcygpIHtcbiAgICBjb25zdCBleGVjdXRpb25Nb2RlcyA9IG5ldyBTZXQoKVxuXG4gICAgZm9yIChjb25zdCB3b3JrZXIgb2YgdGhpcy5yZWFkeVdvcmtlcnMpIHtcbiAgICAgIHRoaXMuX2FkZEFjY2VwdGVkRXhlY3V0aW9uTW9kZXMoe2V4ZWN1dGlvbk1vZGVzLCB3b3JrZXJ9KVxuICAgIH1cblxuICAgIHJldHVybiAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGVbXX0gKi8gKFsuLi5leGVjdXRpb25Nb2Rlc10pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZGQgYWNjZXB0ZWQgZXhlY3V0aW9uIG1vZGVzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7U2V0PGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGU+fSBhcmdzLmV4ZWN1dGlvbk1vZGVzIC0gQWNjZXB0ZWQgbW9kZXMuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy53b3JrZXIgLSBXb3JrZXIgc29ja2V0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9hZGRBY2NlcHRlZEV4ZWN1dGlvbk1vZGVzKHtleGVjdXRpb25Nb2Rlcywgd29ya2VyfSkge1xuICAgIGlmICghd29ya2VyLnN1cHBvcnRzSGFuZG9mZklkUmVwb3J0aW5nKSByZXR1cm5cblxuICAgIGZvciAoY29uc3QgY2FwYWJpbGl0eSBvZiBXT1JLRVJfRVhFQ1VUSU9OX01PREVfQ0FQQUJJTElUSUVTKSB7XG4gICAgICBpZiAoY2FwYWJpbGl0eS5hY2NlcHRzKHdvcmtlcikpIGV4ZWN1dGlvbk1vZGVzLmFkZChjYXBhYmlsaXR5LmV4ZWN1dGlvbk1vZGUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVhZHkgd29ya2VyIGZvciBqb2IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBqb2IgLSBKb2IgYmVpbmcgaGFuZGVkIG9mZi5cbiAgICogQHJldHVybnMge0pzb25Tb2NrZXQgfCB1bmRlZmluZWR9IC0gUmVhZHkgd29ya2VyIGZvciB0aGUgam9iIHR5cGUuXG4gICAqL1xuICByZWFkeVdvcmtlckZvckpvYihqb2IpIHtcbiAgICBmb3IgKGNvbnN0IHdvcmtlciBvZiB0aGlzLnJlYWR5V29ya2Vycykge1xuICAgICAgaWYgKHRoaXMuX3dvcmtlckFjY2VwdHNKb2Ioe2pvYiwgd29ya2VyfSkpIHJldHVybiB3b3JrZXJcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyB3b3JrZXIgYWNjZXB0cyBqb2IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGFyZ3Muam9iIC0gSm9iIGJlaW5nIGhhbmRlZCBvZmYuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy53b3JrZXIgLSBXb3JrZXIgc29ja2V0LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSB3b3JrZXIgYWNjZXB0cyB0aGUgam9iIG1vZGUuXG4gICAqL1xuICBfd29ya2VyQWNjZXB0c0pvYih7am9iLCB3b3JrZXJ9KSB7XG4gICAgaWYgKCF3b3JrZXIuc3VwcG9ydHNIYW5kb2ZmSWRSZXBvcnRpbmcpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgY2FwYWJpbGl0eSA9IFdPUktFUl9FWEVDVVRJT05fTU9ERV9DQVBBQklMSVRJRVNfQllfTU9ERS5nZXQoam9iLmV4ZWN1dGlvbk1vZGUpXG5cbiAgICBpZiAoIWNhcGFiaWxpdHkpIHJldHVybiBmYWxzZVxuXG4gICAgcmV0dXJuIGNhcGFiaWxpdHkuYWNjZXB0cyh3b3JrZXIpXG4gIH1cblxuICAvKipcbiAgICogQXJtcyBhIHNpbmdsZSBgc2V0VGltZW91dGAgZm9yIHRoZSBzb29uZXN0IGZ1dHVyZS1zY2hlZHVsZWQgam9iJ3NcbiAgICogYHNjaGVkdWxlZF9hdF9tc2AuIFJlcGxhY2VzIHRoZSBzZWNvbmQgcmVzcG9uc2liaWxpdHkgb2YgdGhlIGxlZ2FjeVxuICAgKiAxLXNlY29uZCBwb2xsIChiZWNvbWluZy1lbGlnaWJsZSBzY2hlZHVsZWQgam9icykuIFRoZSB0aW1lciBpc1xuICAgKiBpZGVtcG90ZW50bHkgcmUtYXJtZWQgYXQgdGhlIGVuZCBvZiBldmVyeSBkcmFpbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfYXJtU2NoZWR1bGVkVGltZXIoKSB7XG4gICAgaWYgKHRoaXMuX3NjaGVkdWxlZFRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5fc2NoZWR1bGVkVGltZXIpXG4gICAgICB0aGlzLl9zY2hlZHVsZWRUaW1lciA9IHVuZGVmaW5lZFxuICAgIH1cblxuICAgIGlmICh0aGlzLl9zdG9wcGVkIHx8IHRoaXMubGlmZWN5Y2xlU3RhdGUgIT09IFwiYWN0aXZlXCIgfHwgIXRoaXMuX2FjdGl2ZU93bmVyc2hpcFJlYWR5KSByZXR1cm5cbiAgICBpZiAodGhpcy5kaXNwYXRjaFN0cmF0ZWd5ID09PSBcInBvbGxpbmdcIikgcmV0dXJuXG5cbiAgICBjb25zdCBuZXh0ID0gYXdhaXQgdGhpcy5zdG9yZS5uZXh0U2NoZWR1bGVkSm9iKClcbiAgICBsZXQgZGVsYXlcblxuICAgIGlmIChuZXh0ICYmIHR5cGVvZiBuZXh0LnNjaGVkdWxlZEF0TXMgPT09IFwibnVtYmVyXCIpIHtcbiAgICAgIGRlbGF5ID0gTWF0aC5tYXgoMCwgTWF0aC5taW4obmV4dC5zY2hlZHVsZWRBdE1zIC0gdGhpcy5jbG9jay5ub3coKSwgTUFYX1RJTUVSX01TKSlcbiAgICB9XG5cbiAgICAvLyBgbmV4dFNjaGVkdWxlZEpvYmAgb25seSByZXR1cm5zIGZ1dHVyZSBqb2JzLCBzbyBhIGpvYiB0aGF0IGJlY2FtZVxuICAgIC8vIGVsaWdpYmxlIGFmdGVyIHRoZSBkcmFpbidzIGVsaWdpYmxlLWpvYiBwcm9iZSBpcyBpbnZpc2libGUgdG8gaXQuIElmIG9uZVxuICAgIC8vIGlzIGRpc3BhdGNoYWJsZSBub3csIGFybSBhIDAtZGVsYXkgcmUtZHJhaW4gc28gaXQgaXMgZGlzcGF0Y2hlZFxuICAgIC8vIGltbWVkaWF0ZWx5IGluc3RlYWQgb2YgYmVpbmcgc3RyYW5kZWQgdW50aWwgdGhlIG5leHQgZnV0dXJlIHRpbWVyIChvclxuICAgIC8vIGV4dGVybmFsIHNpZ25hbCkgZmlyZXMuXG4gICAgaWYgKGF3YWl0IHRoaXMubmV4dEF2YWlsYWJsZUpvYkZvclJlYWR5V29ya2VycygpKSBkZWxheSA9IDBcblxuICAgIGlmICh0eXBlb2YgZGVsYXkgIT09IFwibnVtYmVyXCIpIHJldHVyblxuXG4gICAgdGhpcy5fc2NoZWR1bGVkVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMuX3NjaGVkdWxlZFRpbWVyID0gdW5kZWZpbmVkXG4gICAgICB2b2lkIHRoaXMuX2RyYWluKClcbiAgICB9LCBkZWxheSlcbiAgfVxuXG4gIGFzeW5jIF9zd2VlcE9ycGhhbnMoKSB7XG4gICAgdHJ5IHtcbiAgICAgIGxldCBvcnBoYW5lZEpvYnNcblxuICAgICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkKSB7XG4gICAgICAgIGNvbnN0IGNvbm5lY3RlZFdvcmtlcklkcyA9IG5ldyBTZXQoKVxuICAgICAgICBmb3IgKGNvbnN0IHdvcmtlciBvZiB0aGlzLndvcmtlcnMpIHtcbiAgICAgICAgICBpZiAod29ya2VyLndvcmtlcklkKSBjb25uZWN0ZWRXb3JrZXJJZHMuYWRkKHdvcmtlci53b3JrZXJJZClcbiAgICAgICAgfVxuICAgICAgICBmb3IgKGNvbnN0IHdvcmtlcklkIG9mIHRoaXMuZGlzY29ubmVjdGVkV29ya2Vycy5rZXlzKCkpIGNvbm5lY3RlZFdvcmtlcklkcy5hZGQod29ya2VySWQpXG5cbiAgICAgICAgY29uc3QgY3V0b2ZmID0gdGhpcy5jbG9jay5ub3coKSAtIEdFTkVSQVRJT05fT1JQSEFORURfQUZURVJfTVNcbiAgICAgICAgY29uc3QgaGFuZG9mZnMgPSAoYXdhaXQgdGhpcy5fZ2VuZXJhdGlvbk93bmVkSGFuZG9mZlNuYXBzaG90KCkpLmZpbHRlcigoaGFuZG9mZikgPT4ge1xuICAgICAgICAgIHJldHVybiBoYW5kb2ZmLmhhbmRlZE9mZkF0TXMgPD0gY3V0b2ZmICYmICFjb25uZWN0ZWRXb3JrZXJJZHMuaGFzKGhhbmRvZmYud29ya2VySWQpXG4gICAgICAgIH0pXG4gICAgICAgIG9ycGhhbmVkSm9icyA9IGhhbmRvZmZzLmxlbmd0aCA9PT0gMFxuICAgICAgICAgID8gW11cbiAgICAgICAgICA6IGF3YWl0IHRoaXMuc3RvcmUubWFya09ycGhhbmVkSGFuZG9mZnMoe2hhbmRvZmZzLCBlcnJvcjogXCJKb2Igb3JwaGFuZWQgYWZ0ZXIgaXRzIGdlbmVyYXRpb24gb3duZXIgZGlzYXBwZWFyZWRcIn0pXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBvcnBoYW5lZEpvYnMgPSBhd2FpdCB0aGlzLnN0b3JlLm1hcmtPcnBoYW5lZEpvYnMoKVxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLl9oYW5kbGVPcnBoYW5lZEpvYnMoe2pvYnM6IG9ycGhhbmVkSm9icywgd2FybmluZzogXCJNYXJrZWQgb3JwaGFuZWQgYmFja2dyb3VuZCBqb2JzXCJ9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICAgIGNvbnN0IHBheWxvYWQgPSB7Y29udGV4dDoge2dlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWQsIHN0YWdlOiBcImJhY2tncm91bmQtam9iLW9ycGhhbi1zd2VlcFwifSwgZXJyb3I6IG5vcm1hbGl6ZWRFcnJvcn1cbiAgICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiRmFpbGVkIHRvIG1hcmsgb3JwaGFuZWQgam9iczpcIiwgbm9ybWFsaXplZEVycm9yXSlcbiAgICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFB1Ymxpc2hlcyB0aGUgY29tbW9uIHBvc3Qtb3JwaGFuIGxpZmVjeWNsZTogd2FrZSBxdWV1ZWQgcmV0cmllcywgZW1pdCBvbmVcbiAgICogaXNvbGF0ZWQgZXZlbnQgcGVyIGFjY2VwdGVkIHRyYW5zaXRpb24sIGFuZCBkcmFpbiBzbyByZWxlYXNlZCBjb25jdXJyZW5jeVxuICAgKiBjYW4gaW1tZWRpYXRlbHkgYWRtaXQgb3RoZXIgd29yay5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd1tdfSBhcmdzLmpvYnMgLSBBY2NlcHRlZCBvcnBoYW4gdHJhbnNpdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLndhcm5pbmcgLSBMaWZlY3ljbGUgbG9nIG1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSByZXN1bHRpbmcgZHJhaW4uXG4gICAqL1xuICBhc3luYyBfaGFuZGxlT3JwaGFuZWRKb2JzKHtqb2JzLCB3YXJuaW5nfSkge1xuICAgIGlmIChqb2JzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhpcy5fbWF5YmVTdG9wUmV0aXJlZCgpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLmxvZ2dlci53YXJuKCgpID0+IFt3YXJuaW5nLCBqb2JzLmxlbmd0aF0pXG4gICAgLy8gUmVjbGFpbWVkIG9ycGhhbnMgY2FuIGJlY29tZSBgcXVldWVkYCBhZ2FpbiDigJQgd2FrZSB0aGUgZGlzcGF0Y2hlciBmaXJzdFxuICAgIC8vIHNvIGFuIGFwcGxpY2F0aW9uIGV2ZW50IGhhbmRsZXIgdGhhdCB0aHJvd3MgYmVsb3cgY2Fubm90IHN0cmFuZCB0aGVtLlxuICAgIHRoaXMuX25vdGlmeUVucXVldWVkKClcbiAgICAvLyBFbWl0IGJlZm9yZSBhd2FpdGluZyB0aGUgZHJhaW4gc28gYSBibG9ja2VkIGRpc3BhdGNoZXIgY2Fubm90IGRlbGF5XG4gICAgLy8gYXBwbGljYXRpb24gcmVjb3ZlcnkuIElzb2xhdGUgaGFuZGxlcnMgc28gb25lIGNhbm5vdCBzdXBwcmVzcyB0aGUgcmVzdC5cbiAgICBmb3IgKGNvbnN0IGpvYiBvZiBqb2JzKSB7XG4gICAgICB0cnkge1xuICAgICAgICB0aGlzLl9lbWl0QmFja2dyb3VuZEpvYk9ycGhhbmVkKHtqb2J9KVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiQSBiYWNrZ3JvdW5kLWpvYi1vcnBoYW5lZCBldmVudCBoYW5kbGVyIHRocmV3OlwiLCBlcnJvcl0pXG4gICAgICB9XG4gICAgfVxuICAgIGF3YWl0IHRoaXMuX2RyYWluKClcbiAgICB0aGlzLl9tYXliZVN0b3BSZXRpcmVkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBEcm9wcyB3b3JrZXJzIHRoYXQgaGF2ZSBnb25lIHNpbGVudCBwYXN0IGB3b3JrZXJTdGFsZVRpbWVvdXRNc2AgKG5vXG4gICAqIGhlYXJ0YmVhdCwgcmVhZHksIG9yIHJlcG9ydCkuIEEgd2VkZ2VkIHdvcmtlciBrZWVwcyBpdHMgc29ja2V0IG9wZW4sIHNvIHRoZVxuICAgKiBgY2xvc2VgLWJhc2VkIGNsZWFudXAgbmV2ZXIgZmlyZXMgYW5kIGl0cyBpbi1mbGlnaHQgbGVhc2VzIOKAlCBhbmQgdGhlIHdob2xlXG4gICAqIHF1ZXVlIOKAlCBzdGF5IHN0dWNrIHVudGlsIGEgaHVtYW4gbm90aWNlcy4gUmVsZWFzaW5nIHRoZSBsb3N0IHdvcmtlcidzXG4gICAqIGxlYXNlcyBsZXRzIGl0cyBqb2JzIHJ1biBlbHNld2hlcmUgYW5kIHN0b3BzIGRpc3BhdGNoIHRvIGl0OyB0aGUgd29ya2VyJ3NcbiAgICogb3duIHByb2Nlc3MgbGlmZWN5Y2xlIGlzIHRoZSBzdXBlcnZpc29yJ3MgY29uY2Vybi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHN3ZWVwLlxuICAgKi9cbiAgYXN5bmMgX3N3ZWVwU3RhbGVXb3JrZXJzKCkge1xuICAgIGlmICh0aGlzLl9zdG9wcGVkKSByZXR1cm5cblxuICAgIGNvbnN0IGN1dG9mZiA9IHRoaXMuY2xvY2subm93KCkgLSB0aGlzLndvcmtlclN0YWxlVGltZW91dE1zXG4gICAgLyoqIEB0eXBlIHtKc29uU29ja2V0W119ICovXG4gICAgY29uc3Qgc3RhbGUgPSBbXVxuXG4gICAgZm9yIChjb25zdCB3b3JrZXIgb2YgdGhpcy53b3JrZXJzKSB7XG4gICAgICAvLyBPbmx5IGV2aWN0IGhlYXJ0YmVhdC1jYXBhYmxlIHdvcmtlcnMuIEEgbGVnYWN5IHdvcmtlciAoZS5nLiBvbmUgZnJvbSB0aGVcbiAgICAgIC8vIHByZXZpb3VzIHJlbGVhc2UgZHVyaW5nIGEgcm9sbGluZyBkZXBsb3kpIG5ldmVyIGhlYXJ0YmVhdHMsIHNvIGV2aWN0aW5nXG4gICAgICAvLyBpdCBvbiBzaWxlbmNlIHdvdWxkIHdyb25nbHkgcmVsZWFzZSB0aGUgbGVhc2VzIG9mIGEgam9iIGl0IGlzIHN0aWxsXG4gICAgICAvLyBydW5uaW5nLiBJdHMgZGlzY29ubmVjdCBpcyBzdGlsbCBoYW5kbGVkIGJ5IHRoZSBzb2NrZXQgYGNsb3NlYCBwYXRoLlxuICAgICAgaWYgKCF3b3JrZXIuc3VwcG9ydHNIZWFydGJlYXQpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGxhc3RTZWVuQXQgPSB0eXBlb2Ygd29ya2VyLmxhc3RTZWVuQXQgPT09IFwibnVtYmVyXCIgPyB3b3JrZXIubGFzdFNlZW5BdCA6IDBcblxuICAgICAgaWYgKGxhc3RTZWVuQXQgPD0gY3V0b2ZmKSBzdGFsZS5wdXNoKHdvcmtlcilcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHdvcmtlciBvZiBzdGFsZSkge1xuICAgICAgdGhpcy5sb2dnZXIud2FybigoKSA9PiBbXCJEcm9wcGluZyBzdGFsZSBiYWNrZ3JvdW5kIGpvYnMgd29ya2VyXCIsIHt3b3JrZXJJZDogd29ya2VyLndvcmtlcklkLCBsYXN0U2VlbkF0OiB3b3JrZXIubGFzdFNlZW5BdH1dKVxuXG4gICAgICB0cnkge1xuICAgICAgICB3b3JrZXIuY2xvc2UoKVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIEFscmVhZHkgY2xvc2luZzsgdGhlIGxlYXNlIHJlbGVhc2UgYmVsb3cgaXMgd2hhdCBtYXR0ZXJzLlxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLl9oYW5kbGVXb3JrZXJTb2NrZXRDbG9zZWQod29ya2VyKVxuICAgIH1cbiAgfVxufVxuIl19