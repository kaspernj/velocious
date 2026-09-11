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
         * @type {ReturnType<typeof setTimeout> | number | undefined} */
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
            if (this.generationId && !this.adapter.supportsOwnedEnqueueFromHandoff()) {
                throw new Error("The configured background jobs adapter does not support atomic owned-handoff enqueue");
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
            this.clock.clearTimeout(this._scheduledTimer);
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
            this.clock.clearTimeout(this._scheduledTimer);
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
            if (message?.type === "enqueue" && !message.producerProof)
                jsonSocket.send({ type: "enqueue-error", error: "Background jobs generation is retired" });
            if (message?.type === "replace-scheduled")
                jsonSocket.send({ type: "replace-scheduled-error", error: "Background jobs generation is retired" });
            if (message?.type === "cancel-scheduled")
                jsonSocket.send({ type: "cancel-scheduled-error", error: "Background jobs generation is retired" });
            if (message?.type === "get-scheduled-job")
                jsonSocket.send({ type: "get-scheduled-job-error", error: "Background jobs generation is retired" });
            if (message?.type === "wake-scheduled")
                jsonSocket.send({ type: "wake-scheduled-error", error: "Background jobs generation is retired" });
            if (message?.type !== "enqueue" || !message.producerProof)
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
            return;
        }
        if (message?.type === "get-scheduled-job") {
            await this._handleGetScheduledJob({ jsonSocket, message });
            return;
        }
        if (message?.type === "wake-scheduled") {
            await this._handleWakeScheduled({ jsonSocket, message });
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
        if (message?.type === "job-accepted") {
            await this._handleJobAccepted({ jsonSocket, message });
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
     * Persists pooled-child acceptance evidence for an active handoff. The
     * report is diagnostic: a stale lease (job already reclaimed or terminal)
     * answers the same `job-updated` acknowledgement as an accepted report, and
     * only a store failure answers `job-update-error` so the worker can retry.
     * @param {object} args - Options.
     * @param {JsonSocket} args.jsonSocket - JSON socket.
     * @param {import("./types.js").BackgroundJobAcceptedMessage} args.message - Message.
     * @returns {Promise<void>} - Resolves when handled.
     */
    async _handleJobAccepted({ jsonSocket, message }) {
        try {
            await this.store.markChildAccepted({
                childInstanceId: message.childInstanceId,
                childPid: message.childPid,
                handedOffAtMs: message.handedOffAtMs,
                handoffId: message.handoffId,
                jobId: message.jobId,
                receivedAtMs: message.receivedAtMs,
                startedAtMs: message.startedAtMs,
                workerId: message.workerId
            });
            jsonSocket.send({ type: "job-updated", jobId: message.jobId });
        }
        catch (error) {
            this._reportJobUpdateFailure({ error, jobId: message.jobId, stage: "background-job-accepted" });
            jsonSocket.send({ type: "job-update-error", jobId: message.jobId, error: "Failed to update job" });
        }
    }
    /**
     * Requires the complete durable lease identity before a generation-mode
     * reporter can mutate a job. Legacy reporters keep their permissive protocol.
     * @param {import("./types.js").BackgroundJobSocketMessage} message - Reporter message.
     * @returns {boolean} - Whether the report lacks its exact generation lease.
     */
    _generationReportIsInvalid(message) {
        if (message?.type !== "job-accepted" && message?.type !== "job-complete" && message?.type !== "job-failed" && message?.type !== "job-reschedule")
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
            if (this.generationId
                && typeof message.producerProof?.workerId === "string"
                && !workerIdBelongsToGeneration({ generationId: this.generationId, workerId: message.producerProof.workerId })) {
                throw VelociousError.safe("Background job producer handoff belongs to another generation.", {
                    code: "background-job-producer-generation-mismatch"
                });
            }
            const request = {
                jobName: message.jobName,
                args: message.args || [],
                options: message.options || {}
            };
            const jobId = this.generationId && message.producerProof
                ? await this.store.enqueueFromOwnedHandoff({ ...request, producerInvocationId: message.producerInvocationId, producerProof: message.producerProof })
                : await this.store.enqueue(request);
            jsonSocket.send({ type: "enqueued", jobId });
            this._notifyEnqueued();
            if (this.lifecycleState === "active")
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
     * Handles a stable schedule lookup and returns only normalized adapter jobs.
     * @param {object} args - Options.
     * @param {JsonSocket} args.jsonSocket - JSON socket.
     * @param {import("./types.js").BackgroundJobGetScheduledMessage} args.message - Message.
     * @returns {Promise<void>} - Resolves when handled.
     */
    async _handleGetScheduledJob({ jsonSocket, message }) {
        try {
            const result = await this.store.getScheduledJob(message.scheduleKey, {
                includeLatestTerminal: message.includeLatestTerminal
            });
            jsonSocket.send({ type: "scheduled-job", ...result });
        }
        catch (error) {
            this._handleClientMutationError({
                context: { scheduleKey: message.scheduleKey, stage: "background-job-get-scheduled" },
                error,
                fallbackMessage: "Failed to read scheduled job",
                jsonSocket,
                logMessage: "Failed to read scheduled background job:",
                responseType: "get-scheduled-job-error"
            });
        }
    }
    /**
     * Handles a stable schedule wake and re-arms dispatch after its transaction commits.
     * @param {object} args - Options.
     * @param {JsonSocket} args.jsonSocket - JSON socket.
     * @param {import("./types.js").BackgroundJobWakeScheduledMessage} args.message - Message.
     * @returns {Promise<void>} - Resolves when handled.
     */
    async _handleWakeScheduled({ jsonSocket, message }) {
        try {
            const result = await this.store.wakeScheduled(message.scheduleKey);
            if (result.outcome === "woken" || result.outcome === "already_due") {
                this._notifyEnqueued();
                await this._drain();
            }
            jsonSocket.send({ type: "schedule-woken", ...result });
        }
        catch (error) {
            this._handleClientMutationError({
                context: { scheduleKey: message.scheduleKey, stage: "background-job-wake-scheduled" },
                error,
                fallbackMessage: "Failed to wake scheduled job",
                jsonSocket,
                logMessage: "Failed to wake scheduled background job:",
                responseType: "wake-scheduled-error"
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
     * @param {"enqueue-error" | "replace-scheduled-error" | "cancel-scheduled-error" | "get-scheduled-job-error" | "wake-scheduled-error"} args.responseType - Response type.
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
                    runnerFailure: message.runnerFailure,
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
     * @param {{error: ReturnType<typeof JSON.parse>, handoffId?: string, handedOffAtMs?: number, job: import("./types.js").BackgroundJobRow, runnerFailure?: import("./types.js").PooledRunnerFailure, workerId?: string}} args - Failure event data.
     * @returns {void}
     */
    _emitBackgroundJobFailed({ error, handoffId, handedOffAtMs, job, runnerFailure, workerId }) {
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
                runnerFailure,
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
                const dispatchedJob = handoff.job || job;
                worker.send({
                    type: "job",
                    payload: {
                        id: dispatchedJob.id,
                        jobName: dispatchedJob.jobName,
                        args: dispatchedJob.args,
                        handoffId: handoff.handoffId,
                        workerId: worker.workerId,
                        handedOffAtMs: handoff.handedOffAtMs,
                        options: {
                            concurrencyKey: dispatchedJob.concurrencyKey || undefined,
                            executionMode: dispatchedJob.executionMode,
                            maxConcurrency: dispatchedJob.maxConcurrency ?? undefined,
                            maxRetries: dispatchedJob.maxRetries ?? undefined,
                            queue: dispatchedJob.queue,
                            scheduledAtMs: dispatchedJob.scheduledAtMs ?? undefined,
                            ...(dispatchedJob.timeoutMs === null ? {} : { timeoutMs: dispatchedJob.timeoutMs })
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
            this.clock.clearTimeout(this._scheduledTimer);
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
        this._scheduledTimer = this.clock.setTimeout(() => {
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
        if (this.lifecycleState === "active")
            await this._reconcileActiveConcurrency();
    }
    /**
     * Repairs durable admission counters on the active main's maintenance cadence
     * and immediately retries dispatch when capacity was recovered.
     * @returns {Promise<void>} - Resolves after repair and any resulting drain.
     */
    async _reconcileActiveConcurrency() {
        try {
            const result = await this.store.reconcileActiveConcurrency();
            if (result.repairedCount > 0)
                await this._drain();
        }
        catch (error) {
            const normalizedError = error instanceof Error ? error : new Error(String(error));
            const payload = { context: { generationId: this.generationId, stage: "background-job-concurrency-reconciliation" }, error: normalizedError };
            const errorEvents = this.configuration.getErrorEvents();
            this.logger.error(() => ["Failed to reconcile background job active-concurrency counts:", normalizedError]);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9iYWNrZ3JvdW5kLWpvYnMvbWFpbi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFFLFVBQVUsRUFBRSxNQUFNLFFBQVEsQ0FBQTtBQUNuQyxPQUFPLEdBQUcsTUFBTSxLQUFLLENBQUE7QUFDckIsT0FBTyxVQUFVLE1BQU0sa0JBQWtCLENBQUE7QUFDekMsT0FBTyx1QkFBdUIsTUFBTSxnQkFBZ0IsQ0FBQTtBQUNwRCxPQUFPLE1BQU0sTUFBTSxjQUFjLENBQUE7QUFDakMsT0FBTyw4QkFBOEIsTUFBTSwyQ0FBMkMsQ0FBQTtBQUN0RixPQUFPLGNBQWMsTUFBTSx1QkFBdUIsQ0FBQTtBQUNsRCxPQUFPLGlCQUFpQixFQUFFLEVBQUUsZ0JBQWdCLEVBQUUsTUFBTSxnQ0FBZ0MsQ0FBQTtBQUNwRixPQUFPLEVBQUUsb0JBQW9CLEVBQUUsMkJBQTJCLEVBQUUsTUFBTSwwQkFBMEIsQ0FBQTtBQUM1RixPQUFPLG9DQUFvQyxNQUFNLCtCQUErQixDQUFBO0FBRWhGOzs7OztHQUtHO0FBQ0g7Ozs7OztHQU1HO0FBQ0gsTUFBTSxnQkFBZ0IsR0FBRyxvQ0FBb0MsQ0FBQTtBQUU3RDs7OztHQUlHO0FBQ0gsTUFBTSxZQUFZLEdBQUcsYUFBYSxDQUFBLENBQUMsYUFBYTtBQUNoRCwrRUFBK0U7QUFDL0UsTUFBTSx1QkFBdUIsR0FBRyxLQUFLLENBQUE7QUFDckMsc0RBQXNEO0FBQ3RELE1BQU0sd0JBQXdCLEdBQUcsS0FBSyxDQUFBO0FBQ3RDLHlGQUF5RjtBQUN6RixNQUFNLHlCQUF5QixHQUFHLEtBQUssQ0FBQTtBQUN2QyxNQUFNLDRCQUE0QixHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsSUFBSSxDQUFBO0FBQ25ELE1BQU0seUNBQXlDLEdBQUcsMkRBQTJELFlBQVksRUFBRSxDQUFBO0FBRTNIOzs7OztHQUtHO0FBQ0gsU0FBUywrQkFB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RSxDQUFBO1FBRWhCLEtBQUssTUFBTSxNQUFNLElBQUksSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ2xDLDJFQUEyRTtZQUMzRSwwRUFBMEU7WUFDMUUsc0VBQXNFO1lBQ3RFLHVFQUF1RTtZQUN2RSxJQUFJLENBQUMsTUFBTSxDQUFDLGlCQUFpQjtnQkFBRSxTQUFRO1lBRXZDLE1BQU0sVUFBVSxHQUFHLE9BQU8sTUFBTSxDQUFDLFVBQVUsS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQTtZQUVoRixJQUFJLFVBQVUsSUFBSSxNQUFNO2dCQUFFLEtBQUssQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDOUMsQ0FBQztRQUVELEtBQUssTUFBTSxNQUFNLElBQUksS0FBSyxFQUFFLENBQUM7WUFDM0IsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyx1Q0FBdUMsRUFBRSxFQUFDLFFBQVEsRUFBRSxNQUFNLENBQUMsUUFBUSxFQUFFLFVBQVUsRUFBRSxNQUFNLENBQUMsVUFBVSxFQUFDLENBQUMsQ0FBQyxDQUFBO1lBRTdILElBQUksQ0FBQztnQkFDSCxNQUFNLENBQUMsS0FBSyxFQUFFLENBQUE7WUFDaEIsQ0FBQztZQUFDLE1BQU0sQ0FBQztnQkFDUCw0REFBNEQ7WUFDOUQsQ0FBQztZQUVELE1BQU0sSUFBSSxDQUFDLHlCQUF5QixDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBQzlDLENBQUM7SUFDSCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHsgcmFuZG9tVVVJRCB9IGZyb20gXCJjcnlwdG9cIlxuaW1wb3J0IG5ldCBmcm9tIFwibmV0XCJcbmltcG9ydCBKc29uU29ja2V0IGZyb20gXCIuL2pzb24tc29ja2V0LmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9ic1NjaGVkdWxlciBmcm9tIFwiLi9zY2hlZHVsZXIuanNcIlxuaW1wb3J0IExvZ2dlciBmcm9tIFwiLi4vbG9nZ2VyLmpzXCJcbmltcG9ydCBQcnVuZVRlcm1pbmFsQmFja2dyb3VuZEpvYnNKb2IgZnJvbSBcIi4uL2pvYnMvcHJ1bmUtdGVybWluYWwtYmFja2dyb3VuZC1qb2JzLmpzXCJcbmltcG9ydCBWZWxvY2lvdXNFcnJvciBmcm9tIFwiLi4vdmVsb2Npb3VzLWVycm9yLmpzXCJcbmltcG9ydCBzaHV0ZG93bkxpZmVjeWNsZSwgeyBydW5TaHV0ZG93blN0ZXBzIH0gZnJvbSBcIi4uL3V0aWxzL3NodXRkb3duLWxpZmVjeWNsZS5qc1wiXG5pbXBvcnQgeyB2YWxpZGF0ZUdlbmVyYXRpb25JZCwgd29ya2VySWRCZWxvbmdzVG9HZW5lcmF0aW9uIH0gZnJvbSBcIi4vZ2VuZXJhdGlvbi1pZGVudGl0eS5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYnNMaWZlY3ljbGVDb250cm9sU2VydmVyIGZyb20gXCIuL2xpZmVjeWNsZS1jb250cm9sLXNlcnZlci5qc1wiXG5cbi8qKlxuICogV29ya2VyRXhlY3V0aW9uTW9kZUNhcGFiaWxpdHkgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFdvcmtlckV4ZWN1dGlvbk1vZGVDYXBhYmlsaXR5XG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9IGV4ZWN1dGlvbk1vZGUgLSBFeGVjdXRpb24gbW9kZS5cbiAqIEBwcm9wZXJ0eSB7KHdvcmtlcjogSnNvblNvY2tldCkgPT4gYm9vbGVhbn0gYWNjZXB0cyAtIFdoZXRoZXIgdGhlIHdvcmtlciBhY2NlcHRzIHRoaXMgbW9kZS5cbiAqL1xuLyoqXG4gKiBDaGFubmVsIHVzZWQgYnkgYGJhY2tncm91bmQtam9icy1tYWluYCB0byBjb29yZGluYXRlIGRpc3BhdGNoIHdha2UtdXBzXG4gKiBhY3Jvc3MgcHJvY2Vzc2VzIHZpYSBCZWFjb24uIFdvcmtlcnMgZG8gTk9UIHN1YnNjcmliZSB0byB0aGlzIGNoYW5uZWxcbiAqIOKAlCB0aGV5IGFscmVhZHkgcmVjZWl2ZSBqb2ItaGFuZG9mZiBtZXNzYWdlcyBvbiB0aGVpciBKc29uU29ja2V0IHRvXG4gKiBtYWluOyB0aGlzIGNoYW5uZWwgZXhpc3RzIHNvIGNyb3NzLXByb2Nlc3MgZW5xdWV1ZXMgKG9yIGZ1dHVyZVxuICogbXVsdGktbWFpbiBkZXBsb3ltZW50cykgY2FuIHBva2UgYW4gaWRsZSBtYWluIHRvIGRyYWluLlxuICovXG5jb25zdCBESVNQQVRDSF9DSEFOTkVMID0gXCJ2ZWxvY2lvdXMtYmFja2dyb3VuZC1qb2JzLWRpc3BhdGNoXCJcblxuLyoqXG4gKiBgc2V0VGltZW91dGAgaXMgaW1wbGVtZW50ZWQgd2l0aCAzMi1iaXQgc2lnbmVkIGRlbGF5cyBvbiBOb2RlOyBwYXNzaW5nXG4gKiBhbnl0aGluZyBsYXJnZXIgc2lsZW50bHkgY2xhbXBzIHRvIDFtcyBhbmQgZmlyZXMgaW1tZWRpYXRlbHkuIENhcCB0aGVcbiAqIHNjaGVkdWxlZC1qb2IgdGltZXIgaGVyZSBhbmQgcmUtYXJtIHdoZW4gaXQgZXhwaXJlcy5cbiAqL1xuY29uc3QgTUFYX1RJTUVSX01TID0gMl8xNDdfNDgzXzY0NyAvLyB+MjQuOCBkYXlzXG4vKiogQSB3b3JrZXIgc2lsZW50IChubyBoZWFydGJlYXQvcmVhZHkvcmVwb3J0KSBsb25nZXIgdGhhbiB0aGlzIGlzIGRyb3BwZWQuICovXG5jb25zdCBXT1JLRVJfU1RBTEVfVElNRU9VVF9NUyA9IDYwMDAwXG4vKiogSG93IG9mdGVuIHRoZSBtYWluIHNjYW5zIHdvcmtlcnMgZm9yIHN0YWxlbmVzcy4gKi9cbmNvbnN0IFdPUktFUl9MSVZFTkVTU19TV0VFUF9NUyA9IDE1MDAwXG4vKiogR3JhY2UgZm9yIHdvcmtlcnMgZnJvbSB0aGUgcHJldmlvdXMgbWFpbiBnZW5lcmF0aW9uIHRvIHJlY29ubmVjdCBhbmQgYWRvcHQgbGVhc2VzLiAqL1xuY29uc3QgV09SS0VSX1JFQ09OTkVDVF9HUkFDRV9NUyA9IDMwMDAwXG5jb25zdCBHRU5FUkFUSU9OX09SUEhBTkVEX0FGVEVSX01TID0gNjAgKiA2MCAqIDEwMDBcbmNvbnN0IFdPUktFUl9SRUNPTk5FQ1RfR1JBQ0VfVkFMSURBVElPTl9NRVNTQUdFID0gYHdvcmtlclJlY29ubmVjdEdyYWNlTXMgbXVzdCBiZSBhbiBpbnRlZ2VyIGJldHdlZW4gMCBhbmQgJHtNQVhfVElNRVJfTVN9YFxuXG4vKipcbiAqIFJlc29sdmVzIGEgc3RhcnR1cCByZWNvbm5lY3QgZ3JhY2Ugd2l0aG91dCBhbGxvd2luZyBOb2RlJ3MgdGltZXIgb3ZlcmZsb3cgdG9cbiAqIHR1cm4gYW4gaW50ZW50aW9uYWxseSBsb25nIGdyYWNlIGludG8gYW4gaW1tZWRpYXRlIHJlY2xhaW0uXG4gKiBAcGFyYW0ge251bWJlciB8IHVuZGVmaW5lZH0gd29ya2VyUmVjb25uZWN0R3JhY2VNcyAtIFJlcXVlc3RlZCByZWNvbm5lY3QgZ3JhY2UuXG4gKiBAcmV0dXJucyB7bnVtYmVyfSAtIFZhbGlkIHRpbWVyIGRlbGF5LlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVXb3JrZXJSZWNvbm5lY3RHcmFjZU1zKHdvcmtlclJlY29ubmVjdEdyYWNlTXMpIHtcbiAgaWYgKHdvcmtlclJlY29ubmVjdEdyYWNlTXMgPT09IHVuZGVmaW5lZCkgcmV0dXJuIFdPUktFUl9SRUNPTk5FQ1RfR1JBQ0VfTVNcbiAgaWYgKCFOdW1iZXIuaXNJbnRlZ2VyKHdvcmtlclJlY29ubmVjdEdyYWNlTXMpIHx8IHdvcmtlclJlY29ubmVjdEdyYWNlTXMgPCAwIHx8IHdvcmtlclJlY29ubmVjdEdyYWNlTXMgPiBNQVhfVElNRVJfTVMpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFdPUktFUl9SRUNPTk5FQ1RfR1JBQ0VfVkFMSURBVElPTl9NRVNTQUdFKVxuICB9XG5cbiAgcmV0dXJuIHdvcmtlclJlY29ubmVjdEdyYWNlTXNcbn1cbi8qKlxuICogV29ya2VyIGV4ZWN1dGlvbiBtb2RlIGNhcGFiaWxpdGllcy5cbiAqIEB0eXBlIHtXb3JrZXJFeGVjdXRpb25Nb2RlQ2FwYWJpbGl0eVtdfSAqL1xuY29uc3QgV09SS0VSX0VYRUNVVElPTl9NT0RFX0NBUEFCSUxJVElFUyA9IFtcbiAge2V4ZWN1dGlvbk1vZGU6IFwiaW5saW5lXCIsIGFjY2VwdHM6ICh3b3JrZXIpID0+IHdvcmtlci5hY2NlcHRzSW5saW5lSm9icyAhPT0gZmFsc2V9LFxuICB7ZXhlY3V0aW9uTW9kZTogXCJmb3JrZWRcIiwgYWNjZXB0czogKHdvcmtlcikgPT4gd29ya2VyLmFjY2VwdHNGb3JrZWRKb2JzICE9PSBmYWxzZX0sXG4gIC8vIFBvb2xlZCBpcyBvcHQtaW46IG9ubHkgd29ya2VycyB0aGF0IGV4cGxpY2l0bHkgYWR2ZXJ0aXNlIGBhY2NlcHRzUG9vbGVkYFxuICAvLyByZWNlaXZlIHBvb2xlZCBqb2JzLiBUaGUgYD09PSB0cnVlYCAocmF0aGVyIHRoYW4gYCE9PSBmYWxzZWApIGNoZWNrIGtlZXBzIGFcbiAgLy8gcHJlLXBvb2xlZCB3b3JrZXIg4oCUIHdoaWNoIG5ldmVyIHNlbmRzIHRoZSBmaWVsZCDigJQgb3V0IG9mIHRoZSBwb29sZWQtY2FwYWJsZVxuICAvLyBzZXQsIHNvIHRoZSBtYWluIG5ldmVyIGRpc3BhdGNoZXMgYSBwb29sZWQgam9iIHRvIGEgd29ya2VyIHRoYXQgY2Fubm90IHJ1blxuICAvLyBvbmUuIFRoaXMgaXMgdGhlIGNvbnNlcnZhdGl2ZSBoYWxmIG9mIHRoZSBleHRlbmRlZCByZWFkaW5lc3MgcHJvdG9jb2wuXG4gIHtleGVjdXRpb25Nb2RlOiBcInBvb2xlZFwiLCBhY2NlcHRzOiAod29ya2VyKSA9PiB3b3JrZXIuYWNjZXB0c1Bvb2xlZEpvYnMgPT09IHRydWUgJiYgKCF3b3JrZXIudXNlc1Bvb2xlZENhcGFjaXR5Q3JlZGl0cyB8fCB3b3JrZXIuYXZhaWxhYmxlUG9vbGVkU2xvdHMgPiAwKX0sXG4gIHtleGVjdXRpb25Nb2RlOiBcInNwYXduZWRcIiwgYWNjZXB0czogKHdvcmtlcikgPT4gd29ya2VyLmFjY2VwdHNTcGF3bmVkSm9icyAhPT0gZmFsc2V9XG5dXG5jb25zdCBXT1JLRVJfRVhFQ1VUSU9OX01PREVfQ0FQQUJJTElUSUVTX0JZX01PREUgPSBuZXcgTWFwKFxuICBXT1JLRVJfRVhFQ1VUSU9OX01PREVfQ0FQQUJJTElUSUVTLm1hcCgoY2FwYWJpbGl0eSkgPT4gW2NhcGFiaWxpdHkuZXhlY3V0aW9uTW9kZSwgY2FwYWJpbGl0eV0pXG4pXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEJhY2tncm91bmRKb2JzTWFpbiB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuaG9zdF0gLSBIb3N0bmFtZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnBvcnRdIC0gUG9ydC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmdlbmVyYXRpb25JZF0gLSBFeHBsaWNpdCByZWxlYXNlIGdlbmVyYXRpb24gaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25Jbml0aWFsU3RhdGV9IFthcmdzLmluaXRpYWxHZW5lcmF0aW9uU3RhdGVdIC0gRXhwbGljaXQgZ2VuZXJhdGlvbiBib290IHN0YXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MubGlmZWN5Y2xlU29ja2V0UGF0aF0gLSBFeHBsaWNpdCBsaWZlY3ljbGUgc29ja2V0IHBhdGguXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy53b3JrZXJTdGFsZVRpbWVvdXRNc10gLSBPdmVycmlkZSBob3cgbG9uZyBhIHNpbGVudCB3b3JrZXIgbWF5IGdvIGJlZm9yZSBiZWluZyBkcm9wcGVkIChkZWZhdWx0IDYwMDAwbXMpLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3Mud29ya2VyTGl2ZW5lc3NTd2VlcE1zXSAtIE92ZXJyaWRlIGhvdyBvZnRlbiBzdGFsZSB3b3JrZXJzIGFyZSBzd2VwdCBmb3IgKGRlZmF1bHQgMTUwMDBtcykuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy53b3JrZXJSZWNvbm5lY3RHcmFjZU1zXSAtIEludGVnZXIgZnJvbSAwIHRocm91Z2ggMiwxNDcsNDgzLDY0NyBvdmVycmlkaW5nIGhvdyBsb25nIHByZXZpb3VzLWdlbmVyYXRpb24gd29ya2VycyBtYXkgcmVjb25uZWN0IGJlZm9yZSBleGFjdCBzdGFydHVwIGxlYXNlcyBhcmUgcmVjbGFpbWVkIChkZWZhdWx0IDMwMDAwbXMpLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmNsb3NlRGF0YWJhc2VDb25uZWN0aW9uc09uU3RvcF0gLSBXaGV0aGVyIHN0b3Agb3ducyBjbG9zaW5nIHRoZSBjb25maWd1cmF0aW9uJ3MgZGF0YWJhc2UgcG9vbHMgKGRlZmF1bHQgdHJ1ZSkuXG4gICAqIEBwYXJhbSB7KCkgPT4gdm9pZCB8IFByb21pc2U8dm9pZD59IFthcmdzLm9uU3RvcHBlZF0gLSBMaWZlY3ljbGUgaG9vayBpbnZva2VkIGFmdGVyIHRoZSBtYWluIHByb2Nlc3MgZmluaXNoZXMgc3RvcHBpbmcuXG4gICAqIEBwYXJhbSB7KGFyZ3M6IHtoYW5kb2ZmOiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JIYW5kb2ZmLCBqb2I6IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30pID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+fSBbYXJncy5hZnRlckhhbmRvZmZDbGFpbV0gLSBFeHBsaWNpdCBoYW5kb2ZmLWNsYWltIG9ic2VydmF0aW9uIGhvb2suXG4gICAqIEBwYXJhbSB7KHdvcmtlcjogSnNvblNvY2tldCkgPT4gdm9pZH0gW2FyZ3Mub25Xb3JrZXJSZWFkeV0gLSBFeHBsaWNpdCByZWFkaW5lc3Mgb2JzZXJ2YXRpb24gaG9vay5cbiAgICogQHBhcmFtIHsod29ya2VyOiBKc29uU29ja2V0KSA9PiB2b2lkfSBbYXJncy5vbldvcmtlckhlYXJ0YmVhdF0gLSBFeHBsaWNpdCBoZWFydGJlYXQgb2JzZXJ2YXRpb24gaG9vay5cbiAgICogQHBhcmFtIHsod29ya2VySWQ6IHN0cmluZykgPT4gdm9pZH0gW2FyZ3Mub25Xb3JrZXJEaXNjb25uZWN0ZWRdIC0gRXhwbGljaXQgZ2VuZXJhdGlvbiBkaXNjb25uZWN0IG9ic2VydmF0aW9uIGhvb2suXG4gICAqIEBwYXJhbSB7KHdvcmtlcklkOiBzdHJpbmcpID0+IHZvaWR9IFthcmdzLm9uV29ya2VySGFuZG9mZnNSZWxlYXNlZF0gLSBFeHBsaWNpdCBncmFjZS1leHBpcnkgb2JzZXJ2YXRpb24gaG9vay5cbiAgICogQHBhcmFtIHsoam9iczogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93W10pID0+IHZvaWR9IFthcmdzLm9uU3RhcnR1cEhhbmRvZmZzUmVjbGFpbWVkXSAtIEV4cGxpY2l0IHN0YXJ0dXAgcmVjbGFpbSBvYnNlcnZhdGlvbiBob29rLlxuICAgKiBAcGFyYW0geyhhcmdzOiB7YWNjZXB0ZWQ6IGJvb2xlYW4sIGpvYklkOiBzdHJpbmcsIHN0YXR1czogXCJjb21wbGV0ZWRcIiB8IFwiZmFpbGVkXCIgfCBcInJlc2NoZWR1bGVkXCJ9KSA9PiB2b2lkfSBbYXJncy5vbkpvYlVwZGF0ZWRdIC0gRXhwbGljaXQgZHVyYWJsZSByZXBvcnQgb2JzZXJ2YXRpb24gaG9vay5cbiAgICogQHBhcmFtIHt7bm93OiAoKSA9PiBudW1iZXIsIHNldFRpbWVvdXQ/OiAoY2FsbGJhY2s6ICgpID0+IHZvaWQsIGRlbGF5TXM6IG51bWJlcikgPT4gUmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudW1iZXIsIGNsZWFyVGltZW91dD86ICh0aW1lcklkOiBSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bWJlcikgPT4gdm9pZH19IFthcmdzLmNsb2NrXSAtIEluamVjdGFibGUgd2FsbCBjbG9jayBmb3IgZGV0ZXJtaW5pc3RpYyBsaWZlY3ljbGUgdGVzdHMuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgaG9zdCwgcG9ydCwgZ2VuZXJhdGlvbklkOiBleHBsaWNpdEdlbmVyYXRpb25JZCwgaW5pdGlhbEdlbmVyYXRpb25TdGF0ZTogZXhwbGljaXRJbml0aWFsR2VuZXJhdGlvblN0YXRlLCBsaWZlY3ljbGVTb2NrZXRQYXRoOiBleHBsaWNpdExpZmVjeWNsZVNvY2tldFBhdGgsIHdvcmtlclN0YWxlVGltZW91dE1zLCB3b3JrZXJMaXZlbmVzc1N3ZWVwTXMsIHdvcmtlclJlY29ubmVjdEdyYWNlTXMsIGNsb3NlRGF0YWJhc2VDb25uZWN0aW9uc09uU3RvcCA9IHRydWUsIG9uU3RvcHBlZCwgYWZ0ZXJIYW5kb2ZmQ2xhaW0sIG9uV29ya2VyUmVhZHksIG9uV29ya2VySGVhcnRiZWF0LCBvbldvcmtlckRpc2Nvbm5lY3RlZCwgb25Xb3JrZXJIYW5kb2Zmc1JlbGVhc2VkLCBvblN0YXJ0dXBIYW5kb2Zmc1JlY2xhaW1lZCwgb25Kb2JVcGRhdGVkLCBjbG9ja30pIHtcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3AgPSBjbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3BcbiAgICB0aGlzLm9uU3RvcHBlZCA9IG9uU3RvcHBlZFxuICAgIHRoaXMuYWZ0ZXJIYW5kb2ZmQ2xhaW0gPSBhZnRlckhhbmRvZmZDbGFpbVxuICAgIHRoaXMub25Xb3JrZXJSZWFkeSA9IG9uV29ya2VyUmVhZHlcbiAgICB0aGlzLm9uV29ya2VySGVhcnRiZWF0ID0gb25Xb3JrZXJIZWFydGJlYXRcbiAgICB0aGlzLm9uV29ya2VyRGlzY29ubmVjdGVkID0gb25Xb3JrZXJEaXNjb25uZWN0ZWRcbiAgICB0aGlzLm9uV29ya2VySGFuZG9mZnNSZWxlYXNlZCA9IG9uV29ya2VySGFuZG9mZnNSZWxlYXNlZFxuICAgIHRoaXMub25TdGFydHVwSGFuZG9mZnNSZWNsYWltZWQgPSBvblN0YXJ0dXBIYW5kb2Zmc1JlY2xhaW1lZFxuICAgIHRoaXMub25Kb2JVcGRhdGVkID0gb25Kb2JVcGRhdGVkXG4gICAgdGhpcy5jbG9jayA9IHtcbiAgICAgIGNsZWFyVGltZW91dDogY2xvY2s/LmNsZWFyVGltZW91dCB8fCAoKHRpbWVySWQpID0+IGNsZWFyVGltZW91dCh0aW1lcklkKSksXG4gICAgICBub3c6IGNsb2NrPy5ub3cgfHwgKCgpID0+IERhdGUubm93KCkpLFxuICAgICAgc2V0VGltZW91dDogY2xvY2s/LnNldFRpbWVvdXQgfHwgKChjYWxsYmFjaywgZGVsYXlNcykgPT4gc2V0VGltZW91dChjYWxsYmFjaywgZGVsYXlNcykpXG4gICAgfVxuICAgIGNvbnN0IGNvbmZpZyA9IGNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKVxuICAgIGNvbnN0IGdlbmVyYXRpb25Db25maWcgPSBjb25maWd1cmF0aW9uLnJlc29sdmVCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25Db25maWcoe1xuICAgICAgZ2VuZXJhdGlvbklkOiBleHBsaWNpdEdlbmVyYXRpb25JZCxcbiAgICAgIGluaXRpYWxHZW5lcmF0aW9uU3RhdGU6IGV4cGxpY2l0SW5pdGlhbEdlbmVyYXRpb25TdGF0ZSxcbiAgICAgIGxpZmVjeWNsZVNvY2tldFBhdGg6IGV4cGxpY2l0TGlmZWN5Y2xlU29ja2V0UGF0aCxcbiAgICAgIHNvdXJjZU5hbWU6IFwiQmFja2dyb3VuZEpvYnNNYWluXCJcbiAgICB9KVxuICAgIHRoaXMuZ2VuZXJhdGlvbklkID0gZ2VuZXJhdGlvbkNvbmZpZy5nZW5lcmF0aW9uSWRcbiAgICB0aGlzLmluaXRpYWxHZW5lcmF0aW9uU3RhdGUgPSBnZW5lcmF0aW9uQ29uZmlnLmluaXRpYWxHZW5lcmF0aW9uU3RhdGVcbiAgICB0aGlzLmxpZmVjeWNsZVNvY2tldFBhdGggPSBnZW5lcmF0aW9uQ29uZmlnLmxpZmVjeWNsZVNvY2tldFBhdGhcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uTGlmZWN5Y2xlU3RhdGV9ICovXG4gICAgdGhpcy5saWZlY3ljbGVTdGF0ZSA9IFwic3RhcnRpbmdcIlxuICAgIHRoaXMuX2FjdGl2ZU93bmVyc2hpcFJlYWR5ID0gZmFsc2VcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fYWN0aXZhdGlvblByb21pc2UgPSB1bmRlZmluZWRcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fcmV0aXJlbWVudFByb21pc2UgPSB1bmRlZmluZWRcbiAgICAvKiogQHR5cGUge1NldDxKc29uU29ja2V0Pn0gKi9cbiAgICB0aGlzLmNhbmRpZGF0ZVJlYWR5V29ya2VycyA9IG5ldyBTZXQoKVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywge3dvcmtlcjogSnNvblNvY2tldCwgdGltZXI6IFJldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVtYmVyfT59ICovXG4gICAgdGhpcy5kaXNjb25uZWN0ZWRXb3JrZXJzID0gbmV3IE1hcCgpXG4gICAgdGhpcy5fbGlmZWN5Y2xlUmVxdWVzdExlYXNlcyA9IDBcbiAgICB0aGlzLl9hY3RpdmVOb25Xb3JrZXJSZXF1ZXN0cyA9IDBcbiAgICAvKipcbiAgICAgKiBSZXNvbHZlcyBzdG9wIG9ic2VydmF0aW9uLlxuICAgICAqIEB0eXBlIHsoKSA9PiB2b2lkfVxuICAgICAqL1xuICAgIHRoaXMuX3Jlc29sdmVTdG9wcGVkID0gKCkgPT4ge31cbiAgICB0aGlzLl9zdG9wcGVkUHJvbWlzZSA9IG5ldyBQcm9taXNlKCgvKiogQHR5cGUgeyh2YWx1ZTogdm9pZCkgPT4gdm9pZH0gKi8gcmVzb2x2ZSkgPT4geyB0aGlzLl9yZXNvbHZlU3RvcHBlZCA9IHJlc29sdmUgfSlcbiAgICB0aGlzLmhvc3QgPSBob3N0IHx8IGNvbmZpZy5ob3N0XG4gICAgdGhpcy5wb3J0ID0gdHlwZW9mIHBvcnQgPT09IFwibnVtYmVyXCIgPyBwb3J0IDogY29uZmlnLnBvcnRcbiAgICB0aGlzLmRpc3BhdGNoU3RyYXRlZ3kgPSBjb25maWcuZGlzcGF0Y2hTdHJhdGVneVxuICAgIHRoaXMucG9sbEludGVydmFsTXMgPSBjb25maWcucG9sbEludGVydmFsTXNcbiAgICB0aGlzLnJldGVudGlvbiA9IGNvbmZpZy5yZXRlbnRpb25cbiAgICAvLyBBIHdvcmtlciB0aGF0IHN0b3BzIHNlbmRpbmcgYW55dGhpbmcgKGhlYXJ0YmVhdC9yZWFkeS9yZXBvcnQpIGZvciB0aGlzXG4gICAgLy8gbG9uZyBpcyB0cmVhdGVkIGFzIHdlZGdlZC9kZWFkOiBpdHMgbGVhc2VzIGFyZSByZWxlYXNlZCBhbmQgaXQgaXMgZHJvcHBlZC5cbiAgICB0aGlzLndvcmtlclN0YWxlVGltZW91dE1zID0gdHlwZW9mIHdvcmtlclN0YWxlVGltZW91dE1zID09PSBcIm51bWJlclwiICYmIHdvcmtlclN0YWxlVGltZW91dE1zID49IDEgPyB3b3JrZXJTdGFsZVRpbWVvdXRNcyA6IFdPUktFUl9TVEFMRV9USU1FT1VUX01TXG4gICAgdGhpcy53b3JrZXJMaXZlbmVzc1N3ZWVwTXMgPSB0eXBlb2Ygd29ya2VyTGl2ZW5lc3NTd2VlcE1zID09PSBcIm51bWJlclwiICYmIHdvcmtlckxpdmVuZXNzU3dlZXBNcyA+PSAxID8gd29ya2VyTGl2ZW5lc3NTd2VlcE1zIDogV09SS0VSX0xJVkVORVNTX1NXRUVQX01TXG4gICAgdGhpcy53b3JrZXJSZWNvbm5lY3RHcmFjZU1zID0gbm9ybWFsaXplV29ya2VyUmVjb25uZWN0R3JhY2VNcyh3b3JrZXJSZWNvbm5lY3RHcmFjZU1zKVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9hZGFwdGVyLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5hZGFwdGVyID0gdW5kZWZpbmVkXG4gICAgdGhpcy5sb2dnZXIgPSBuZXcgTG9nZ2VyKHRoaXMpXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtTZXQ8SnNvblNvY2tldD59ICovXG4gICAgdGhpcy53b3JrZXJzID0gbmV3IFNldCgpXG4gICAgLyoqIEB0eXBlIHtTZXQ8SnNvblNvY2tldD59ICovXG4gICAgdGhpcy5jb25uZWN0aW9ucyA9IG5ldyBTZXQoKVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7U2V0PEpzb25Tb2NrZXQ+fSAqL1xuICAgIHRoaXMucmVhZHlXb3JrZXJzID0gbmV3IFNldCgpXG4gICAgLyoqXG4gICAgICogQWN0aXZlIGR1cmFibGUgaGFuZG9mZnMga2V5ZWQgYnkgdGhlIGV4YWN0IHdvcmtlciBzb2NrZXQgdGhhdCByZWNlaXZlZCB0aGVtLlxuICAgICAqIEB0eXBlIHtNYXA8SnNvblNvY2tldCwgTWFwPHN0cmluZywgc3RyaW5nPj59ICovXG4gICAgdGhpcy53b3JrZXJIYW5kb2ZmcyA9IG5ldyBNYXAoKVxuICAgIC8qKlxuICAgICAqIEV4YWN0IGNhbGxlci1nZW5lcmF0ZWQgbGVhc2VzIHdob3NlIGNsYWltIG91dGNvbWUgd2FzIGFtYmlndW91cyBvciB3aG9zZVxuICAgICAqIHByZS1kaXNwYXRjaCByZWxlYXNlIGhhcyBub3QgeWV0IGJlZW4gYWNrbm93bGVkZ2VkLiBSZXRhaW5lZCB1bnRpbCBhXG4gICAgICogZmVuY2VkIHJldHVybiBzdWNjZWVkcyAoaW5jbHVkaW5nIGFuIGV4YWN0IG5vLW9wKS5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywgc3RyaW5nPn0gKi9cbiAgICB0aGlzLnBlbmRpbmdIYW5kb2ZmUmVjb3ZlcmllcyA9IG5ldyBNYXAoKVxuICAgIC8qKlxuICAgICAqIEhhbmRvZmYtYWRvcHRpb24gcXVlcmllcyBzdGFydGVkIGJ5IHdvcmtlciBoZWxsbyBtZXNzYWdlcy4gU2h1dGRvd24gbXVzdFxuICAgICAqIHdhaXQgZm9yIHRoZXNlIGJlZm9yZSBjbG9zaW5nIHRoZSBjb25maWd1cmF0aW9uJ3MgZGF0YWJhc2UgcG9vbHMuXG4gICAgICogQHR5cGUge1NldDxQcm9taXNlPHZvaWQ+Pn0gKi9cbiAgICB0aGlzLmluZmxpZ2h0V29ya2VySGFuZG9mZkFkb3B0aW9ucyA9IG5ldyBTZXQoKVxuICAgIC8qKlxuICAgICAqIFdvcmtlciBpZHMgd2hvc2UgaGFuZG9mZnMgd2VyZSBzdWNjZXNzZnVsbHkgYWRvcHRlZCBieSBhIHN0aWxsLWxpdmVcbiAgICAgKiBjb25uZWN0aW9uIGluIHRoaXMgbWFpbiBnZW5lcmF0aW9uLlxuICAgICAqIEB0eXBlIHtTZXQ8c3RyaW5nPn1cbiAgICAgKi9cbiAgICB0aGlzLnJlY29ubmVjdGVkV29ya2VySWRzID0gbmV3IFNldCgpXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JIYW5kb2ZmU25hcHNob3RbXX0gKi9cbiAgICB0aGlzLnN0YXJ0dXBIYW5kb2ZmU25hcHNob3QgPSBbXVxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPltdfSAqL1xuICAgIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmQWRvcHRpb25zQXREZWFkbGluZSA9IFtdXG4gICAgdGhpcy5fc3RhcnR1cEhhbmRvZmZHcmFjZUVsYXBzZWQgPSBmYWxzZVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7bmV0LlNlcnZlciB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLnNlcnZlciA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fcG9sbFRpbWVyID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bWJlciB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9zY2hlZHVsZWRUaW1lciA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fZXJyb3JSZXRyeVRpbWVyID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9vcnBoYW5UaW1lciA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0SW50ZXJ2YWw+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX3dvcmtlclN0YWxlVGltZXIgPSB1bmRlZmluZWRcbiAgICAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVtYmVyIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVRpbWVyID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVByb21pc2UgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge0JhY2tncm91bmRKb2JzU2NoZWR1bGVyIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuc2NoZWR1bGVyID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fZHJhaW5pbmcgPSBmYWxzZVxuICAgIHRoaXMuX3JlZHJhaW5RdWV1ZWQgPSBmYWxzZVxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9kcmFpblByb21pc2UgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9zdG9wcGVkID0gZmFsc2VcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5zdG9wUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7KCgpID0+IHZvaWQpIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX3Vuc3Vic2NyaWJlQmVhY29uID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHsoKC4uLmFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gdm9pZCkgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fYmVhY29uQ29ubmVjdEhhbmRsZXIgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge2ltcG9ydChcIi4uL2JlYWNvbi9jbGllbnQuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4uL2JlYWNvbi9pbi1wcm9jZXNzLWNsaWVudC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2JlYWNvbkNsaWVudCA9IHVuZGVmaW5lZFxuICAgIC8qKiBAdHlwZSB7QmFja2dyb3VuZEpvYnNMaWZlY3ljbGVDb250cm9sU2VydmVyIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMubGlmZWN5Y2xlQ29udHJvbFNlcnZlciA9IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIENvbXBhdGliaWxpdHkgYWxpYXMgZm9yIGludGVncmF0aW9ucyB0aGF0IGluc3BlY3QgdGhlIGFjdGl2ZSBtYWluIHN0b3JlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9hZGFwdGVyLmpzXCIpLmRlZmF1bHR9IC0gQWRhcHRlciBhY3F1aXJlZCBieSBzdGFydC5cbiAgICovXG4gIGdldCBzdG9yZSgpIHtcbiAgICBpZiAoIXRoaXMuYWRhcHRlcikgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIG1haW4gaGFzIG5vdCBhY3F1aXJlZCBpdHMgYWRhcHRlclwiKVxuXG4gICAgcmV0dXJuIHRoaXMuYWRhcHRlclxuICB9XG5cbiAgLyoqXG4gICAqIFByZXNlcnZlcyB0aGUgaGlzdG9yaWNhbCBzdWJjbGFzcyBzZWFtIHdoaWxlIGtlZXBpbmcgb25lIGFkYXB0ZXIgcmVmZXJlbmNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vYWRhcHRlci5qc1wiKS5kZWZhdWx0fSBhZGFwdGVyIC0gQWRhcHRlciB0byBhc3NpZ24uXG4gICAqL1xuICBzZXQgc3RvcmUoYWRhcHRlcikge1xuICAgIHRoaXMuYWRhcHRlciA9IGFkYXB0ZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0YXJ0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGxpc3RlbmluZy5cbiAgICovXG4gIGFzeW5jIHN0YXJ0KCkge1xuICAgIHRoaXMuX3N0b3BwZWQgPSBmYWxzZVxuICAgIHRoaXMuc3RvcFByb21pc2UgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9hY3RpdmVPd25lcnNoaXBSZWFkeSA9IGZhbHNlXG4gICAgdGhpcy5saWZlY3ljbGVTdGF0ZSA9IFwic3RhcnRpbmdcIlxuICAgIHRoaXMuX3N0b3BwZWRQcm9taXNlID0gbmV3IFByb21pc2UoKC8qKiBAdHlwZSB7KHZhbHVlOiB2b2lkKSA9PiB2b2lkfSAqLyByZXNvbHZlKSA9PiB7IHRoaXMuX3Jlc29sdmVTdG9wcGVkID0gcmVzb2x2ZSB9KVxuICAgIHRoaXMucmVjb25uZWN0ZWRXb3JrZXJJZHMuY2xlYXIoKVxuICAgIHRoaXMuc3RhcnR1cEhhbmRvZmZTbmFwc2hvdCA9IFtdXG4gICAgdGhpcy5fc3RhcnR1cEhhbmRvZmZBZG9wdGlvbnNBdERlYWRsaW5lID0gW11cbiAgICB0aGlzLl9zdGFydHVwSGFuZG9mZkdyYWNlRWxhcHNlZCA9IGZhbHNlXG4gICAgdGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIHRoaXMuY29uZmlndXJhdGlvbi5zZXRDdXJyZW50KClcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uaW5pdGlhbGl6ZSh7dHlwZTogXCJiYWNrZ3JvdW5kLWpvYnMtbWFpblwifSlcbiAgICAgIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5jb25uZWN0QmVhY29uKHtwZWVyVHlwZTogXCJiYWNrZ3JvdW5kLWpvYnMtbWFpblwifSlcblxuICAgICAgaWYgKCF0aGlzLmFkYXB0ZXIpIHtcbiAgICAgICAgdGhpcy5hZGFwdGVyID0gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmFjcXVpcmVSZWFkeUJhY2tncm91bmRKb2JzQWRhcHRlcigpXG4gICAgICB9XG4gICAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQgJiYgIXRoaXMuYWRhcHRlci5zdXBwb3J0c1JlbGVhc2VTY29wZWRHZW5lcmF0aW9ucygpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlRoZSBjb25maWd1cmVkIGJhY2tncm91bmQgam9icyBhZGFwdGVyIGRvZXMgbm90IHN1cHBvcnQgcmVsZWFzZS1zY29wZWQgZ2VuZXJhdGlvbnNcIilcbiAgICAgIH1cbiAgICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCAmJiAhdGhpcy5hZGFwdGVyLnN1cHBvcnRzT3duZWRFbnF1ZXVlRnJvbUhhbmRvZmYoKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJUaGUgY29uZmlndXJlZCBiYWNrZ3JvdW5kIGpvYnMgYWRhcHRlciBkb2VzIG5vdCBzdXBwb3J0IGF0b21pYyBvd25lZC1oYW5kb2ZmIGVucXVldWVcIilcbiAgICAgIH1cblxuICAgICAgaWYgKCF0aGlzLmdlbmVyYXRpb25JZCB8fCB0aGlzLmluaXRpYWxHZW5lcmF0aW9uU3RhdGUgIT09IFwiY2FuZGlkYXRlXCIpIHtcbiAgICAgICAgdGhpcy5zdGFydHVwSGFuZG9mZlNuYXBzaG90ID0gYXdhaXQgdGhpcy5fZ2VuZXJhdGlvbk93bmVkSGFuZG9mZlNuYXBzaG90KClcbiAgICAgIH1cbiAgICAgIGNvbnN0IHNlcnZlciA9IG5ldC5jcmVhdGVTZXJ2ZXIoKHNvY2tldCkgPT4gdGhpcy5faGFuZGxlQ29ubmVjdGlvbihzb2NrZXQpKVxuICAgICAgdGhpcy5zZXJ2ZXIgPSBzZXJ2ZXJcblxuICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBzZXJ2ZXIub25jZShcImVycm9yXCIsIHJlamVjdClcbiAgICAgICAgc2VydmVyLmxpc3Rlbih0aGlzLnBvcnQsIHRoaXMuaG9zdCwgKCkgPT4gcmVzb2x2ZSh1bmRlZmluZWQpKVxuICAgICAgfSlcblxuICAgICAgY29uc3QgYWRkcmVzcyA9IHNlcnZlci5hZGRyZXNzKClcbiAgICAgIGlmIChhZGRyZXNzICYmIHR5cGVvZiBhZGRyZXNzID09PSBcIm9iamVjdFwiKSB7XG4gICAgICAgIHRoaXMucG9ydCA9IGFkZHJlc3MucG9ydFxuICAgICAgfVxuXG4gICAgICB0aGlzLmxpZmVjeWNsZVN0YXRlID0gdGhpcy5nZW5lcmF0aW9uSWQgPyB0aGlzLmluaXRpYWxHZW5lcmF0aW9uU3RhdGUgOiBcImFjdGl2ZVwiXG5cbiAgICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCAmJiB0aGlzLmxpZmVjeWNsZVNvY2tldFBhdGgpIHtcbiAgICAgICAgdGhpcy5saWZlY3ljbGVDb250cm9sU2VydmVyID0gbmV3IEJhY2tncm91bmRKb2JzTGlmZWN5Y2xlQ29udHJvbFNlcnZlcih7XG4gICAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgICAgIGdlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWQsXG4gICAgICAgICAgbWFpbjogdGhpcyxcbiAgICAgICAgICBzb2NrZXRQYXRoOiB0aGlzLmxpZmVjeWNsZVNvY2tldFBhdGhcbiAgICAgICAgfSlcbiAgICAgICAgYXdhaXQgdGhpcy5saWZlY3ljbGVDb250cm9sU2VydmVyLnN0YXJ0KClcbiAgICAgIH1cblxuICAgICAgdGhpcy5fd29ya2VyU3RhbGVUaW1lciA9IHNldEludGVydmFsKCgpID0+IHtcbiAgICAgICAgdm9pZCB0aGlzLl9zd2VlcFN0YWxlV29ya2VycygpXG4gICAgICB9LCB0aGlzLndvcmtlckxpdmVuZXNzU3dlZXBNcylcblxuICAgICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwiYWN0aXZlXCIpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fc3RhcnRBY3RpdmVPd25lcnNoaXAoXCJhY3RpdmVcIilcbiAgICAgIH0gZWxzZSBpZiAodGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJyZXRpcmVkXCIpIHtcbiAgICAgICAgdGhpcy5fc3RhcnRHZW5lcmF0aW9uUmVjb3ZlcnlPd25lcnNoaXAoKVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBsZXQgY2xlYW51cEVycm9yXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuc3RvcCgpXG4gICAgICB9IGNhdGNoIChjYXVnaHRDbGVhbnVwRXJyb3IpIHtcbiAgICAgICAgY2xlYW51cEVycm9yID0gY2F1Z2h0Q2xlYW51cEVycm9yXG4gICAgICB9XG5cbiAgICAgIGlmIChjbGVhbnVwRXJyb3IpIHtcbiAgICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKFxuICAgICAgICAgIFtlcnJvciwgY2xlYW51cEVycm9yXSxcbiAgICAgICAgICBcIkJhY2tncm91bmQgam9icyBtYWluIHN0YXJ0dXAgYW5kIGNsZWFudXAgZmFpbGVkXCIsXG4gICAgICAgICAge2NhdXNlOiBlcnJvcn1cbiAgICAgICAgKVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0b3AuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY2xvc2VkLlxuICAgKi9cbiAgc3RvcCgpIHtcbiAgICBpZiAoIXRoaXMuc3RvcFByb21pc2UpIHRoaXMuc3RvcFByb21pc2UgPSB0aGlzLl9zdG9wKClcblxuICAgIHJldHVybiB0aGlzLnN0b3BQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0aGUgbWFpbi1wcm9jZXNzIHNodXRkb3duIGxpZmVjeWNsZSBvbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNsb3NlZC5cbiAgICovXG4gIGFzeW5jIF9zdG9wKCkge1xuICAgIHRoaXMuX3N0b3BwZWQgPSB0cnVlXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgc2h1dGRvd25MaWZlY3ljbGUoe1xuICAgICAgICBvblN0b3BwZWQ6IHRoaXMub25TdG9wcGVkLFxuICAgICAgICBzaHV0ZG93bjogYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIHRoaXMuX2Nsb3NlV29ya2VycygpXG4gICAgICAgICAgdGhpcy5fY2xlYXJUaW1lcnMoKVxuICAgICAgICAgIHRoaXMuX2Rpc2Nvbm5lY3RCZWFjb25IYW5kbGVycygpXG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuc2NoZWR1bGVyPy5zdG9wKClcbiAgICAgICAgICAgIGlmICh0aGlzLl9kcmFpblByb21pc2UpIGF3YWl0IHRoaXMuX2RyYWluUHJvbWlzZVxuICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICBhd2FpdCB0aGlzLl9kcmFpbldvcmtlckhhbmRvZmZBZG9wdGlvbnMoKVxuICAgICAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLl9kcmFpblN0YXJ0dXBIYW5kb2ZmUmVjbGFpbSgpXG4gICAgICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5fc3RvcEJlYWNvbkFuZFNlcnZlcigpXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuYWRhcHRlciA9IHVuZGVmaW5lZFxuICAgICAgdGhpcy5saWZlY3ljbGVTdGF0ZSA9IFwic3RvcHBlZFwiXG4gICAgICB0aGlzLl9yZXNvbHZlU3RvcHBlZCgpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xvc2Ugd29ya2Vycy5cbiAgICogQHJldHVybnMge3ZvaWR9ICovXG4gIF9jbG9zZVdvcmtlcnMoKSB7XG4gICAgZm9yIChjb25zdCBjb25uZWN0aW9uIG9mIHRoaXMuY29ubmVjdGlvbnMpIHtcbiAgICAgIGNvbm5lY3Rpb24uY2xvc2UoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsZWFyIHRpbWVycy5cbiAgICogQHJldHVybnMge3ZvaWR9ICovXG4gIF9jbGVhclRpbWVycygpIHtcbiAgICBpZiAodGhpcy5fcG9sbFRpbWVyKSBjbGVhckludGVydmFsKHRoaXMuX3BvbGxUaW1lcilcbiAgICBpZiAodGhpcy5fc2NoZWR1bGVkVGltZXIpIHRoaXMuY2xvY2suY2xlYXJUaW1lb3V0KHRoaXMuX3NjaGVkdWxlZFRpbWVyKVxuICAgIGlmICh0aGlzLl9lcnJvclJldHJ5VGltZXIpIGNsZWFyVGltZW91dCh0aGlzLl9lcnJvclJldHJ5VGltZXIpXG4gICAgaWYgKHRoaXMuX29ycGhhblRpbWVyKSBjbGVhckludGVydmFsKHRoaXMuX29ycGhhblRpbWVyKVxuICAgIGlmICh0aGlzLl93b3JrZXJTdGFsZVRpbWVyKSBjbGVhckludGVydmFsKHRoaXMuX3dvcmtlclN0YWxlVGltZXIpXG4gICAgaWYgKHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVRpbWVyKSB0aGlzLmNsb2NrLmNsZWFyVGltZW91dCh0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1UaW1lcilcbiAgICBmb3IgKGNvbnN0IHt0aW1lcn0gb2YgdGhpcy5kaXNjb25uZWN0ZWRXb3JrZXJzLnZhbHVlcygpKSB0aGlzLmNsb2NrLmNsZWFyVGltZW91dCh0aW1lcilcbiAgICB0aGlzLmRpc2Nvbm5lY3RlZFdvcmtlcnMuY2xlYXIoKVxuICAgIHRoaXMuX3BvbGxUaW1lciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX3NjaGVkdWxlZFRpbWVyID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fZXJyb3JSZXRyeVRpbWVyID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fb3JwaGFuVGltZXIgPSB1bmRlZmluZWRcbiAgICB0aGlzLl93b3JrZXJTdGFsZVRpbWVyID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltVGltZXIgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRpc2Nvbm5lY3QgYmVhY29uIGhhbmRsZXJzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gKi9cbiAgX2Rpc2Nvbm5lY3RCZWFjb25IYW5kbGVycygpIHtcbiAgICBpZiAodGhpcy5fdW5zdWJzY3JpYmVCZWFjb24pIHtcbiAgICAgIHRoaXMuX3Vuc3Vic2NyaWJlQmVhY29uKClcbiAgICAgIHRoaXMuX3Vuc3Vic2NyaWJlQmVhY29uID0gdW5kZWZpbmVkXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX2JlYWNvbkNsaWVudCAmJiB0aGlzLl9iZWFjb25Db25uZWN0SGFuZGxlcikge1xuICAgICAgdGhpcy5fYmVhY29uQ2xpZW50Lm9mZihcImNvbm5lY3RcIiwgdGhpcy5fYmVhY29uQ29ubmVjdEhhbmRsZXIpXG4gICAgfVxuICAgIHRoaXMuX2JlYWNvbkNvbm5lY3RIYW5kbGVyID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fYmVhY29uQ2xpZW50ID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdG9wIGJlYWNvbiBhbmQgc2VydmVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgYXN5bmMgX3N0b3BCZWFjb25BbmRTZXJ2ZXIoKSB7XG4gICAgYXdhaXQgcnVuU2h1dGRvd25TdGVwcyh7XG4gICAgICBtZXNzYWdlOiBcIkJhY2tncm91bmQgam9icyBtYWluIGFwcGxpY2F0aW9uIGFuZCBmcmFtZXdvcmsgc2h1dGRvd24gZmFpbGVkXCIsXG4gICAgICBzdGVwczogW1xuICAgICAgICBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubGlmZWN5Y2xlQ29udHJvbFNlcnZlcj8uY2xvc2UoKVxuICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICB0aGlzLmxpZmVjeWNsZUNvbnRyb2xTZXJ2ZXIgPSB1bmRlZmluZWRcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIC4uLih0aGlzLmNsb3NlRGF0YWJhc2VDb25uZWN0aW9uc09uU3RvcFxuICAgICAgICAgID8gW2FzeW5jICgpID0+IGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5zaHV0ZG93bigpXVxuICAgICAgICAgIDogW10pLFxuICAgICAgICBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uZGlzY29ubmVjdEJlYWNvbigpLFxuICAgICAgICBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLl9jbG9zZVNlcnZlcigpLFxuICAgICAgICBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgaWYgKHRoaXMuY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zT25TdG9wKSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zKClcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmNsb3NlQmFja2dyb3VuZEpvYnNBZGFwdGVyKClcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIF1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xvc2Ugc2VydmVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgYXN5bmMgX2Nsb3NlU2VydmVyKCkge1xuICAgIGlmICghdGhpcy5zZXJ2ZXIpIHJldHVyblxuXG4gICAgY29uc3Qge3NlcnZlcn0gPSB0aGlzXG4gICAgdGhpcy5zZXJ2ZXIgPSB1bmRlZmluZWRcbiAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gc2VydmVyLmNsb3NlKCgpID0+IHJlc29sdmUodW5kZWZpbmVkKSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcG9ydC5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBCb3VuZCBwb3J0LlxuICAgKi9cbiAgZ2V0UG9ydCgpIHtcbiAgICByZXR1cm4gdGhpcy5wb3J0XG4gIH1cblxuICAvKipcbiAgICogR2V0cyB0aGUgbGlmZWN5Y2xlIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25MaWZlY3ljbGVTdGF0ZX0gLSBDdXJyZW50IGxpZmVjeWNsZSBzdGF0ZS5cbiAgICovXG4gIGdldExpZmVjeWNsZVN0YXRlKCkgeyByZXR1cm4gdGhpcy5saWZlY3ljbGVTdGF0ZSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYSBwcm9taXNlIHRoYXQgc2V0dGxlcyBvbmx5IGFmdGVyIHRoZSBtYWluIGhhcyBmdWxseSBzdG9wcGVkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBTdG9wIGNvbXBsZXRpb24uXG4gICAqL1xuICBhc3luYyB3YWl0VW50aWxTdG9wcGVkKCkgeyBhd2FpdCB0aGlzLl9zdG9wcGVkUHJvbWlzZSB9XG5cbiAgLyoqXG4gICAqIFNuYXBzaG90cyBvbmx5IGV4YWN0IGR1cmFibGUgb3duZXJzIGZyb20gdGhpcyByZWxlYXNlIGdlbmVyYXRpb24uXG4gICAqIExlZ2FjeSBtb2RlIGludGVudGlvbmFsbHkgcmV0YWlucyBpdHMgaGlzdG9yaWNhbCBnbG9iYWwgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhhbmRvZmZTbmFwc2hvdFtdPn0gLSBPd25lZCBzbmFwc2hvdC5cbiAgICovXG4gIGFzeW5jIF9nZW5lcmF0aW9uT3duZWRIYW5kb2ZmU25hcHNob3QoKSB7XG4gICAgY29uc3QgaGFuZG9mZnMgPSBhd2FpdCB0aGlzLnN0b3JlLnNuYXBzaG90SGFuZGVkT2ZmSm9icygpXG5cbiAgICBpZiAoIXRoaXMuZ2VuZXJhdGlvbklkKSByZXR1cm4gaGFuZG9mZnNcbiAgICBjb25zdCBnZW5lcmF0aW9uSWQgPSB0aGlzLmdlbmVyYXRpb25JZFxuXG4gICAgcmV0dXJuIGhhbmRvZmZzLmZpbHRlcigoe3dvcmtlcklkfSkgPT4gd29ya2VySWRCZWxvbmdzVG9HZW5lcmF0aW9uKHtnZW5lcmF0aW9uSWQsIHdvcmtlcklkfSkpXG4gIH1cblxuICAvKipcbiAgICogQWNxdWlyZXMgc2NoZWR1bGluZyBhbmQgZGlzcGF0Y2ggb3duZXJzaGlwIGZvciBhbiBhY3RpdmUgZ2VuZXJhdGlvbi5cbiAgICogQHBhcmFtIHtcImFjdGl2ZVwiIHwgXCJjYW5kaWRhdGVcIn0gZXhwZWN0ZWRMaWZlY3ljbGVTdGF0ZSAtIFN0YXRlIHRoYXQgc3RpbGwgb3ducyBhY3RpdmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIGFjdGl2ZSBvd25lcnNoaXAgd2FzIGVzdGFibGlzaGVkLlxuICAgKi9cbiAgYXN5bmMgX3N0YXJ0QWN0aXZlT3duZXJzaGlwKGV4cGVjdGVkTGlmZWN5Y2xlU3RhdGUpIHtcbiAgICBhd2FpdCB0aGlzLnN0b3JlLnJlY29uY2lsZVF1ZXVlQ29uY3VycmVuY3koKVxuICAgIGlmICh0aGlzLmxpZmVjeWNsZVN0YXRlICE9PSBleHBlY3RlZExpZmVjeWNsZVN0YXRlKSByZXR1cm4gZmFsc2VcbiAgICB0aGlzLl9zZXR1cERpc3BhdGNoVHJpZ2dlcnMoKVxuICAgIHRoaXMuX3NldHVwU3RhcnR1cEhhbmRvZmZSZWNsYWltKClcbiAgICB0aGlzLl9zdGFydE9ycGhhblN3ZWVwKClcbiAgICBhd2FpdCB0aGlzLl9zdGFydFNjaGVkdWxlcigpXG4gICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgIT09IGV4cGVjdGVkTGlmZWN5Y2xlU3RhdGUpIHtcbiAgICAgIGlmICh0aGlzLnNjaGVkdWxlcikgYXdhaXQgdGhpcy5zY2hlZHVsZXIuc3RvcCgpXG4gICAgICB0aGlzLnNjaGVkdWxlciA9IHVuZGVmaW5lZFxuICAgICAgdGhpcy5fY2xlYXJEaXNwYXRjaFRpbWVycygpXG4gICAgICB0aGlzLl9kaXNjb25uZWN0QmVhY29uSGFuZGxlcnMoKVxuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuICAgIHRoaXMuX2FjdGl2ZU93bmVyc2hpcFJlYWR5ID0gdHJ1ZVxuICAgIHRoaXMuX2NyZWRpdFJlYWR5V29ya2VycygpXG4gICAgYXdhaXQgdGhpcy5fZHJhaW4oKVxuICAgIHJldHVybiB0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBleHBlY3RlZExpZmVjeWNsZVN0YXRlXG4gIH1cblxuICAvKiogU3RhcnRzIGV4YWN0IHJlY292ZXJ5IGR1dGllcyB3aXRob3V0IGFjcXVpcmluZyBnbG9iYWwgZGlzcGF0Y2ggb3duZXJzaGlwLiAqL1xuICBfc3RhcnRHZW5lcmF0aW9uUmVjb3ZlcnlPd25lcnNoaXAoKSB7XG4gICAgdGhpcy5fc2V0dXBTdGFydHVwSGFuZG9mZlJlY2xhaW0oKVxuICAgIHRoaXMuX3N0YXJ0T3JwaGFuU3dlZXAoKVxuICAgIHRoaXMuX21heWJlU3RvcFJldGlyZWQoKVxuICB9XG5cbiAgLyoqIFN0YXJ0cyB0aGUgZ2VuZXJhdGlvbi1mZW5jZWQgb3JwaGFuIHN3ZWVwLiAqL1xuICBfc3RhcnRPcnBoYW5Td2VlcCgpIHtcbiAgICBpZiAodGhpcy5fb3JwaGFuVGltZXIpIHJldHVyblxuXG4gICAgdGhpcy5fb3JwaGFuVGltZXIgPSBzZXRJbnRlcnZhbCgoKSA9PiB7IHZvaWQgdGhpcy5fc3dlZXBPcnBoYW5zKCkgfSwgNjAwMDApXG4gIH1cblxuICAvKipcbiAgICogU3RhcnRzIHNjaGVkdWxlIG93bmVyc2hpcCBleGFjdGx5IG9uY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHNjaGVkdWxlcyBhcmUgbG9hZGVkLlxuICAgKi9cbiAgYXN5bmMgX3N0YXJ0U2NoZWR1bGVyKCkge1xuICAgIGlmICh0aGlzLnNjaGVkdWxlcikgcmV0dXJuXG5cbiAgICB0aGlzLnNjaGVkdWxlciA9IG5ldyBCYWNrZ3JvdW5kSm9ic1NjaGVkdWxlcih7XG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24sXG4gICAgICBlbnF1ZXVlSm9iOiBhc3luYyAoe2FyZ3MsIGpvYkNsYXNzLCBvcHRpb25zfSkgPT4ge1xuICAgICAgICBhd2FpdCB0aGlzLnN0b3JlLmVucXVldWUoe1xuICAgICAgICAgIGpvYk5hbWU6IGpvYkNsYXNzLmpvYk5hbWUoKSxcbiAgICAgICAgICBhcmdzLFxuICAgICAgICAgIG9wdGlvbnM6IGpvYkNsYXNzLl93aXRoSm9iQ29udGV4dCh7am9iQXJnczogYXJncywgam9iT3B0aW9uczogb3B0aW9uc30pXG4gICAgICAgIH0pXG4gICAgICAgIHRoaXMuX25vdGlmeUVucXVldWVkKClcbiAgICAgICAgdm9pZCB0aGlzLl9kcmFpbigpXG4gICAgICB9XG4gICAgfSlcbiAgICBhd2FpdCB0aGlzLnNjaGVkdWxlci5zdGFydCgpXG5cbiAgICBjb25zdCByZXRlbnRpb25TY2hlZHVsZSA9IFBydW5lVGVybWluYWxCYWNrZ3JvdW5kSm9ic0pvYi5zY2hlZHVsZUNvbmZpZ3VyYXRpb24odGhpcy5yZXRlbnRpb24pXG5cbiAgICBpZiAocmV0ZW50aW9uU2NoZWR1bGUpIHtcbiAgICAgIHRoaXMuc2NoZWR1bGVyLnNjaGVkdWxlSm9iKHtqb2JDb25maWd1cmF0aW9uOiByZXRlbnRpb25TY2hlZHVsZSwgam9iS2V5OiBcInZlbG9jaW91c1BydW5lVGVybWluYWxCYWNrZ3JvdW5kSm9ic1wifSlcbiAgICB9XG4gIH1cblxuICAvKiogQ3JlZGl0cyByZWFkaW5lc3MgYWR2ZXJ0aXNlbWVudHMgcmVjb3JkZWQgd2hpbGUgZGlzcGF0Y2ggd2FzIGZlbmNlZC4gKi9cbiAgX2NyZWRpdFJlYWR5V29ya2VycygpIHtcbiAgICBmb3IgKGNvbnN0IHdvcmtlciBvZiB0aGlzLmNhbmRpZGF0ZVJlYWR5V29ya2Vycykge1xuICAgICAgaWYgKHRoaXMud29ya2Vycy5oYXMod29ya2VyKSAmJiAhd29ya2VyLmlzRHJhaW5pbmcgJiYgd29ya2VyLnN1cHBvcnRzSGFuZG9mZklkUmVwb3J0aW5nKSB7XG4gICAgICAgIHRoaXMucmVhZHlXb3JrZXJzLmFkZCh3b3JrZXIpXG4gICAgICB9XG4gICAgfVxuICAgIHRoaXMuY2FuZGlkYXRlUmVhZHlXb3JrZXJzLmNsZWFyKClcbiAgfVxuXG4gIC8qKlxuICAgKiBBY3RpdmF0ZXMgYSBjYW5kaWRhdGUgYWZ0ZXIgaXRzIHN1cGVydmlzb3IgaGFzIHJldGlyZWQgdGhlIG9sZCBnZW5lcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBzY2hlZHVsaW5nIGFuZCBkaXNwYXRjaCBhcmUgYWN0aXZlLlxuICAgKi9cbiAgYWN0aXZhdGUoKSB7XG4gICAgaWYgKCF0aGlzLmdlbmVyYXRpb25JZCkgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIGdlbmVyYXRpb24gYWN0aXZhdGlvbiByZXF1aXJlcyBnZW5lcmF0aW9uIG1vZGVcIilcbiAgICBpZiAodGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJhY3RpdmVcIikgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpXG4gICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgIT09IFwiY2FuZGlkYXRlXCIpIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IGFjdGl2YXRlIGJhY2tncm91bmQgam9icyBnZW5lcmF0aW9uIGZyb20gJHt0aGlzLmxpZmVjeWNsZVN0YXRlfWApXG4gICAgaWYgKCF0aGlzLl9hY3RpdmF0aW9uUHJvbWlzZSkgdGhpcy5fYWN0aXZhdGlvblByb21pc2UgPSB0aGlzLl9hY3RpdmF0ZSgpXG5cbiAgICByZXR1cm4gdGhpcy5fYWN0aXZhdGlvblByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFjdGl2YXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIEFjdGl2YXRpb24gY29tcGxldGlvbi5cbiAgICovXG4gIGFzeW5jIF9hY3RpdmF0ZSgpIHtcbiAgICB0aGlzLmxvZ2dlci5pbmZvKCgpID0+IFtcIkJhY2tncm91bmQgam9icyBnZW5lcmF0aW9uIGFjdGl2YXRpb24gc3RhcnRpbmdcIiwge2dlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWR9XSlcbiAgICBjb25zdCBvd25lcnNoaXBTdGFydGVkID0gYXdhaXQgdGhpcy5fc3RhcnRBY3RpdmVPd25lcnNoaXAoXCJjYW5kaWRhdGVcIilcbiAgICBpZiAoIW93bmVyc2hpcFN0YXJ0ZWQgfHwgdGhpcy5saWZlY3ljbGVTdGF0ZSAhPT0gXCJjYW5kaWRhdGVcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIGdlbmVyYXRpb24gcmV0aXJlbWVudCBzdGFydGVkIGJlZm9yZSBhY3RpdmF0aW9uIGFjcXVpcmVkIG93bmVyc2hpcFwiKVxuICAgIH1cbiAgICB0aGlzLmxpZmVjeWNsZVN0YXRlID0gXCJhY3RpdmVcIlxuICAgIHRoaXMuX2NyZWRpdFJlYWR5V29ya2VycygpXG4gICAgdGhpcy5sb2dnZXIuaW5mbygoKSA9PiBbXCJCYWNrZ3JvdW5kIGpvYnMgZ2VuZXJhdGlvbiBhY3RpdmF0aW9uIGFja25vd2xlZGdlZFwiLCB7Z2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZH1dKVxuICAgIHZvaWQgdGhpcy5fZHJhaW4oKS5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIkJhY2tncm91bmQgam9icyBnZW5lcmF0aW9uIHBvc3QtYWN0aXZhdGlvbiBkcmFpbiBmYWlsZWRcIiwge2Vycm9yLCBnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkfV0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBFc3RhYmxpc2hlcyB0aGUgc3luY2hyb25vdXMgcmV0aXJlbWVudCBmZW5jZSBhbmQgdGhlbiBkcmFpbnMgb3duZXJzaGlwIHNldHVwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgcmV0aXJlbWVudCBmZW5jZSBpcyBkdXJhYmxlIGluIG1lbW9yeS5cbiAgICovXG4gIHJldGlyZSgpIHtcbiAgICBpZiAoIXRoaXMuZ2VuZXJhdGlvbklkKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgZ2VuZXJhdGlvbiByZXRpcmVtZW50IHJlcXVpcmVzIGdlbmVyYXRpb24gbW9kZVwiKVxuICAgIGlmICh0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcInJldGlyaW5nXCIgfHwgdGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJyZXRpcmVkXCIpIHJldHVybiBQcm9taXNlLnJlc29sdmUoKVxuICAgIGNvbnN0IGFjdGl2YXRpb25JblByb2dyZXNzID0gdGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJjYW5kaWRhdGVcIiAmJiBCb29sZWFuKHRoaXMuX2FjdGl2YXRpb25Qcm9taXNlKVxuICAgIGlmICh0aGlzLmxpZmVjeWNsZVN0YXRlICE9PSBcImFjdGl2ZVwiICYmICFhY3RpdmF0aW9uSW5Qcm9ncmVzcykgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgcmV0aXJlIGJhY2tncm91bmQgam9icyBnZW5lcmF0aW9uIGZyb20gJHt0aGlzLmxpZmVjeWNsZVN0YXRlfWApXG5cbiAgICB0aGlzLmxpZmVjeWNsZVN0YXRlID0gXCJyZXRpcmluZ1wiXG4gICAgdGhpcy5fYWN0aXZlT3duZXJzaGlwUmVhZHkgPSBmYWxzZVxuICAgIHRoaXMucmVhZHlXb3JrZXJzLmNsZWFyKClcbiAgICB0aGlzLmNhbmRpZGF0ZVJlYWR5V29ya2Vycy5jbGVhcigpXG4gICAgdGhpcy5fY2xlYXJEaXNwYXRjaFRpbWVycygpXG4gICAgdGhpcy5fZGlzY29ubmVjdEJlYWNvbkhhbmRsZXJzKClcbiAgICB0aGlzLl9yZXRpcmVtZW50UHJvbWlzZSA9IHRoaXMuX3JldGlyZSgpXG4gICAgdm9pZCB0aGlzLl9yZXRpcmVtZW50UHJvbWlzZS5jYXRjaCgoZXJyb3IpID0+IHRoaXMuX3JlcG9ydENvbm5lY3Rpb25IYW5kbGVyRXJyb3IoZXJyb3IpKVxuXG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXRpcmVtZW50IGFmdGVyIGl0cyBzeW5jaHJvbm91cyBmZW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmV0aXJlbWVudCBmZW5jZSBjb21wbGV0aW9uLlxuICAgKi9cbiAgYXN5bmMgX3JldGlyZSgpIHtcbiAgICBpZiAodGhpcy5fYWN0aXZhdGlvblByb21pc2UpIGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChbdGhpcy5fYWN0aXZhdGlvblByb21pc2VdKVxuICAgIGlmICh0aGlzLnNjaGVkdWxlcikgYXdhaXQgdGhpcy5zY2hlZHVsZXIuc3RvcCgpXG4gICAgdGhpcy5zY2hlZHVsZXIgPSB1bmRlZmluZWRcbiAgICBpZiAodGhpcy5fZHJhaW5Qcm9taXNlKSBhd2FpdCB0aGlzLl9kcmFpblByb21pc2VcbiAgICBpZiAodGhpcy5fc3RvcHBlZCkgcmV0dXJuXG5cbiAgICBmb3IgKGNvbnN0IHdvcmtlciBvZiB0aGlzLndvcmtlcnMpIHtcbiAgICAgIHdvcmtlci5pc0RyYWluaW5nID0gdHJ1ZVxuICAgICAgd29ya2VyLnNlbmQoe3R5cGU6IFwicmV0aXJlXCIsIGdlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWR9KVxuICAgIH1cblxuICAgIHRoaXMubGlmZWN5Y2xlU3RhdGUgPSBcInJldGlyZWRcIlxuICAgIHRoaXMuX3N0YXJ0R2VuZXJhdGlvblJlY292ZXJ5T3duZXJzaGlwKClcbiAgfVxuXG4gIC8qKiBDbGVhcnMgdGltZXJzIHRoYXQgY2FuIGluaXRpYXRlIG5ldyBnbG9iYWwgZGlzcGF0Y2ggb3Igc2NoZWR1bGUgd29yay4gKi9cbiAgX2NsZWFyRGlzcGF0Y2hUaW1lcnMoKSB7XG4gICAgaWYgKHRoaXMuX3BvbGxUaW1lcikgY2xlYXJJbnRlcnZhbCh0aGlzLl9wb2xsVGltZXIpXG4gICAgaWYgKHRoaXMuX3NjaGVkdWxlZFRpbWVyKSB0aGlzLmNsb2NrLmNsZWFyVGltZW91dCh0aGlzLl9zY2hlZHVsZWRUaW1lcilcbiAgICBpZiAodGhpcy5fZXJyb3JSZXRyeVRpbWVyKSBjbGVhclRpbWVvdXQodGhpcy5fZXJyb3JSZXRyeVRpbWVyKVxuICAgIHRoaXMuX3BvbGxUaW1lciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX3NjaGVkdWxlZFRpbWVyID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fZXJyb3JSZXRyeVRpbWVyID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKiogSG9sZHMgdGhlIG1haW4gb3BlbiB1bnRpbCBhIGxpZmVjeWNsZSByZXNwb25zZSBoYXMgZmx1c2hlZC4gKi9cbiAgYWNxdWlyZUxpZmVjeWNsZVJlcXVlc3RMZWFzZSgpIHsgdGhpcy5fbGlmZWN5Y2xlUmVxdWVzdExlYXNlcyArPSAxIH1cblxuICAvKiogUmVsZWFzZXMgb25lIGxpZmVjeWNsZS1yZXNwb25zZSBsZWFzZSBhZnRlciBpdHMgc29ja2V0IHdyaXRlIGNhbGxiYWNrLiAqL1xuICByZWxlYXNlTGlmZWN5Y2xlUmVxdWVzdExlYXNlKCkge1xuICAgIGlmICh0aGlzLl9saWZlY3ljbGVSZXF1ZXN0TGVhc2VzIDwgMSkgdGhyb3cgbmV3IEVycm9yKFwiTm8gYmFja2dyb3VuZCBqb2JzIGxpZmVjeWNsZSByZXF1ZXN0IGxlYXNlIHRvIHJlbGVhc2VcIilcbiAgICB0aGlzLl9saWZlY3ljbGVSZXF1ZXN0TGVhc2VzIC09IDFcbiAgICB0aGlzLl9tYXliZVN0b3BSZXRpcmVkKClcbiAgfVxuXG4gIC8qKiBTdG9wcyBhIHJldGlyZWQgZ2VuZXJhdGlvbiBvbmx5IGFmdGVyIGl0cyBleGFjdCBvd25lcnNoaXAgaGFzIGRyYWluZWQuICovXG4gIF9tYXliZVN0b3BSZXRpcmVkKCkge1xuICAgIGlmICh0aGlzLmxpZmVjeWNsZVN0YXRlICE9PSBcInJldGlyZWRcIiB8fCB0aGlzLl9zdG9wcGVkIHx8IHRoaXMuc3RvcFByb21pc2UpIHJldHVyblxuICAgIGlmICh0aGlzLl9saWZlY3ljbGVSZXF1ZXN0TGVhc2VzID4gMCB8fCB0aGlzLl9hY3RpdmVOb25Xb3JrZXJSZXF1ZXN0cyA+IDAgfHwgdGhpcy53b3JrZXJzLnNpemUgPiAwIHx8IHRoaXMuZGlzY29ubmVjdGVkV29ya2Vycy5zaXplID4gMCkgcmV0dXJuXG4gICAgaWYgKHRoaXMuaW5mbGlnaHRXb3JrZXJIYW5kb2ZmQWRvcHRpb25zLnNpemUgPiAwIHx8IHRoaXMucGVuZGluZ0hhbmRvZmZSZWNvdmVyaWVzLnNpemUgPiAwKSByZXR1cm5cbiAgICBpZiAodGhpcy5fZHJhaW5Qcm9taXNlIHx8IHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVByb21pc2UgfHwgdGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltVGltZXIpIHJldHVyblxuICAgIGlmICh0aGlzLnN0YXJ0dXBIYW5kb2ZmU25hcHNob3QubGVuZ3RoID4gMCkgcmV0dXJuXG5cbiAgICBmb3IgKGNvbnN0IGhhbmRvZmZzIG9mIHRoaXMud29ya2VySGFuZG9mZnMudmFsdWVzKCkpIHtcbiAgICAgIGlmIChoYW5kb2Zmcy5zaXplID4gMCkgcmV0dXJuXG4gICAgfVxuXG4gICAgdm9pZCB0aGlzLnN0b3AoKS5jYXRjaCgoZXJyb3IpID0+IHRoaXMuX3JlcG9ydENvbm5lY3Rpb25IYW5kbGVyRXJyb3IoZXJyb3IpKVxuICB9XG5cbiAgLyoqXG4gICAqIFdpcmVzIHVwIHRoZSBkaXNwYXRjaC10cmlnZ2VyaW5nIHNpZ25hbCBzb3VyY2VzIGZvciB0aGUgY29uZmlndXJlZFxuICAgKiBzdHJhdGVneS4gSW4gYFwiYmVhY29uXCJgIG1vZGUgKGRlZmF1bHQpIHRoaXMgbWVhbnMgc3Vic2NyaWJpbmcgdG8gdGhlXG4gICAqIGB2ZWxvY2lvdXMtYmFja2dyb3VuZC1qb2JzLWRpc3BhdGNoYCBjaGFubmVsIGZvciBjcm9zcy1wcm9jZXNzXG4gICAqIHdha2UtdXBzLCBsaXN0ZW5pbmcgZm9yIEJlYWNvbiAocmUpY29ubmVjdHMgdG8gY2F0Y2ggdXAgb24gbWlzc2VkXG4gICAqIHdvcmssIGFuZCByZWx5aW5nIG9uIGRpcmVjdCBpbi1wcm9jZXNzIGNhbGxzIGZyb20gYF9oYW5kbGVFbnF1ZXVlYCxcbiAgICogYF9oYW5kbGVKb2JDb21wbGV0ZWAvYEZhaWxlZGAsIHdvcmtlciBoZWxsby9yZWFkeSwgYW5kIHRoZVxuICAgKiBzY2hlZHVsZWQtam9iIGBzZXRUaW1lb3V0YC4gSW4gYFwicG9sbGluZ1wiYCBtb2RlIHdlIHJlc3RvcmUgdGhlXG4gICAqIGxlZ2FjeSBmaXhlZC1pbnRlcnZhbCBwb2xsIGZvciB1c2VycyB3aG8gd2FudCB0aGUgcHJldmlvdXMgYmVoYXZpb3IuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3NldHVwRGlzcGF0Y2hUcmlnZ2VycygpIHtcbiAgICBpZiAodGhpcy5kaXNwYXRjaFN0cmF0ZWd5ID09PSBcInBvbGxpbmdcIikge1xuICAgICAgdGhpcy5fcG9sbFRpbWVyID0gc2V0SW50ZXJ2YWwoKCkgPT4ge1xuICAgICAgICB2b2lkIHRoaXMuX3JldHJ5QWZ0ZXJFcnJvcigpXG4gICAgICB9LCB0aGlzLnBvbGxJbnRlcnZhbE1zKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgYmVhY29uQ2xpZW50ID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEJlYWNvbkNsaWVudCgpXG4gICAgaWYgKCFiZWFjb25DbGllbnQpIHJldHVyblxuXG4gICAgdGhpcy5fYmVhY29uQ2xpZW50ID0gYmVhY29uQ2xpZW50XG5cbiAgICB0aGlzLl91bnN1YnNjcmliZUJlYWNvbiA9IGJlYWNvbkNsaWVudC5vbkJyb2FkY2FzdCgobWVzc2FnZSkgPT4ge1xuICAgICAgaWYgKG1lc3NhZ2U/LmNoYW5uZWwgIT09IERJU1BBVENIX0NIQU5ORUwpIHJldHVyblxuICAgICAgdm9pZCB0aGlzLl9kcmFpbigpXG4gICAgfSlcblxuICAgIC8vIERyYWluIG9uIGV2ZXJ5IChyZSljb25uZWN0IHRvIGNhdGNoIHVwIG9uIGpvYnMgZW5xdWV1ZWQgd2hpbGUgdGhlXG4gICAgLy8gYnVzIHdhcyB1bnJlYWNoYWJsZS4gVGhlIERCIGlzIHRoZSBkdXJhYmxlIGxvZzsgQmVhY29uIGlzIGp1c3QgdGhlXG4gICAgLy8gd2FrZS11cCBzaWduYWwuXG4gICAgdGhpcy5fYmVhY29uQ29ubmVjdEhhbmRsZXIgPSAoKSA9PiB7XG4gICAgICB2b2lkIHRoaXMuX2RyYWluKClcbiAgICB9XG4gICAgYmVhY29uQ2xpZW50Lm9uKFwiY29ubmVjdFwiLCB0aGlzLl9iZWFjb25Db25uZWN0SGFuZGxlcilcbiAgfVxuXG4gIC8qKlxuICAgKiBBcm1zIHRoZSBib3VuZGVkIGFkb3B0aW9uIGdyYWNlIG9ubHkgd2hlbiBzdGFydHVwIGZvdW5kIGV4YWN0IHBlcnNpc3RlZFxuICAgKiBoYW5kb2Zmcy4gVGhlIHRpbWVyIGlzIHVucmVmZWQgc28gYW4gb3RoZXJ3aXNlLWZpbmlzaGVkIHByb2Nlc3MgaXMgbmV2ZXJcbiAgICogcmV0YWluZWQgc29sZWx5IHRvIHBlcmZvcm0gdGhpcyBjbGVhbnVwLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zZXR1cFN0YXJ0dXBIYW5kb2ZmUmVjbGFpbSgpIHtcbiAgICBpZiAodGhpcy5zdGFydHVwSGFuZG9mZlNuYXBzaG90Lmxlbmd0aCA9PT0gMCkgcmV0dXJuXG4gICAgaWYgKHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVRpbWVyIHx8IHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVByb21pc2UgfHwgdGhpcy5fc3RhcnR1cEhhbmRvZmZHcmFjZUVsYXBzZWQpIHJldHVyblxuXG4gICAgdGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltVGltZXIgPSB0aGlzLmNsb2NrLnNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltVGltZXIgPSB1bmRlZmluZWRcbiAgICAgIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmQWRvcHRpb25zQXREZWFkbGluZSA9IFsuLi50aGlzLmluZmxpZ2h0V29ya2VySGFuZG9mZkFkb3B0aW9uc11cbiAgICAgIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmR3JhY2VFbGFwc2VkID0gdHJ1ZVxuICAgICAgdm9pZCB0aGlzLl9zdGFydFN0YXJ0dXBIYW5kb2ZmUmVjbGFpbSgpXG4gICAgfSwgdGhpcy53b3JrZXJSZWNvbm5lY3RHcmFjZU1zKVxuICAgIGlmICh0eXBlb2YgdGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltVGltZXIgPT09IFwib2JqZWN0XCIpIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVRpbWVyLnVucmVmKClcbiAgfVxuXG4gIC8qKlxuICAgKiBTdGFydHMgb25lIHRyYWNrZWQgc3RhcnR1cC1yZWNsYWltIHBhc3MsIGNvYWxlc2NpbmcgbGlmZWN5Y2xlIGFuZCByZXRyeVxuICAgKiBjYWxsZXJzIHNvIHNodXRkb3duIGNhbiB3YWl0IGZvciBkdXJhYmxlIG11dGF0aW9uIGJlZm9yZSBjbG9zaW5nIHBvb2xzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGlzIHBhc3Mgc2V0dGxlcy5cbiAgICovXG4gIF9zdGFydFN0YXJ0dXBIYW5kb2ZmUmVjbGFpbSgpIHtcbiAgICBpZiAodGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltUHJvbWlzZSkgcmV0dXJuIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVByb21pc2VcblxuICAgIGNvbnN0IHJlY2xhaW0gPSB0aGlzLl9yZWNsYWltRGlzY29ubmVjdGVkU3RhcnR1cEhhbmRvZmZzKClcblxuICAgIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVByb21pc2UgPSByZWNsYWltXG4gICAgY29uc3QgY2xlYXJSZWNsYWltID0gKCkgPT4ge1xuICAgICAgaWYgKHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVByb21pc2UgPT09IHJlY2xhaW0pIHtcbiAgICAgICAgdGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgICAgfVxuICAgIH1cbiAgICB2b2lkIHJlY2xhaW0udGhlbihjbGVhclJlY2xhaW0sIGNsZWFyUmVjbGFpbSlcblxuICAgIHJldHVybiByZWNsYWltXG4gIH1cblxuICAvKipcbiAgICogV2FpdHMgZm9yIGFuIGFscmVhZHktc3RhcnRlZCBzdGFydHVwIHJlY2xhaW0gYmVmb3JlIGFkYXB0ZXIgc2h1dGRvd24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gbm8gcGFzcyByZW1haW5zLlxuICAgKi9cbiAgYXN5bmMgX2RyYWluU3RhcnR1cEhhbmRvZmZSZWNsYWltKCkge1xuICAgIHdoaWxlICh0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1Qcm9taXNlKSB7XG4gICAgICBhd2FpdCB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1Qcm9taXNlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE9ycGhhbnMgb25seSBzdGFydHVwLXNuYXBzaG90dGVkIGxlYXNlcyB3aG9zZSBzdGFibGUgd29ya2VyIGlkIGhhcyBub3QgYmVlblxuICAgKiBvYnNlcnZlZCBieSB0aGlzIG1haW4gZ2VuZXJhdGlvbi4gU3RvcmUgZmVuY2luZyByZWplY3RzIGNvbXBsZXRlZCxcbiAgICogcmV0dXJuZWQsIHJlcGxhY2VkLCBhbmQgcmUtaGFuZGVkLW9mZiByb3dzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciByZWNsYWltIG9yIHJldGFpbmVkIHJldHJ5IHN0YXRlLlxuICAgKi9cbiAgYXN5bmMgX3JlY2xhaW1EaXNjb25uZWN0ZWRTdGFydHVwSGFuZG9mZnMoKSB7XG4gICAgaWYgKHRoaXMuX3N0b3BwZWQgfHwgIXRoaXMuX3N0YXJ0dXBIYW5kb2ZmR3JhY2VFbGFwc2VkKSByZXR1cm5cbiAgICBpZiAodGhpcy5zdGFydHVwSGFuZG9mZlNuYXBzaG90Lmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICBhd2FpdCB0aGlzLl93YWl0Rm9yU3RhcnR1cEhhbmRvZmZBZG9wdGlvbnNBdERlYWRsaW5lKClcbiAgICBpZiAodGhpcy5fc3RvcHBlZCkgcmV0dXJuXG5cbiAgICBjb25zdCBoYW5kb2ZmcyA9IHRoaXMuc3RhcnR1cEhhbmRvZmZTbmFwc2hvdC5maWx0ZXIoKHt3b3JrZXJJZH0pID0+ICF0aGlzLnJlY29ubmVjdGVkV29ya2VySWRzLmhhcyh3b3JrZXJJZCkpXG5cbiAgICBpZiAoaGFuZG9mZnMubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aGlzLnN0YXJ0dXBIYW5kb2ZmU25hcHNob3QgPSBbXVxuICAgICAgdGhpcy5fbWF5YmVTdG9wUmV0aXJlZCgpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBsZXQgb3JwaGFuZWRKb2JzXG5cbiAgICB0cnkge1xuICAgICAgb3JwaGFuZWRKb2JzID0gYXdhaXQgdGhpcy5zdG9yZS5tYXJrT3JwaGFuZWRIYW5kb2Zmcyh7XG4gICAgICAgIGVycm9yOiBcIkpvYiBvcnBoYW5lZCBhZnRlciBpdHMgcHJlLXJlc3RhcnQgd29ya2VyIGRpZCBub3QgcmVjb25uZWN0XCIsXG4gICAgICAgIGhhbmRvZmZzXG4gICAgICB9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLl9yZXBvcnRTdGFydHVwSGFuZG9mZlJlY2xhaW1FcnJvcihlcnJvcilcbiAgICAgIHRoaXMuX3NjaGVkdWxlRXJyb3JSZXRyeSgpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLnN0YXJ0dXBIYW5kb2ZmU25hcHNob3QgPSBbXVxuICAgIGF3YWl0IHRoaXMuX2hhbmRsZU9ycGhhbmVkSm9icyh7XG4gICAgICBqb2JzOiBvcnBoYW5lZEpvYnMsXG4gICAgICB3YXJuaW5nOiBcIlJlY2xhaW1lZCBiYWNrZ3JvdW5kIGpvYnMgZnJvbSB3b3JrZXJzIGFic2VudCBhZnRlciBtYWluIHJlc3RhcnQgZ3JhY2VcIlxuICAgIH0pXG4gICAgdGhpcy5vblN0YXJ0dXBIYW5kb2Zmc1JlY2xhaW1lZD8uKG9ycGhhbmVkSm9icylcbiAgICB0aGlzLl9tYXliZVN0b3BSZXRpcmVkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBMZXRzIGFkb3B0aW9uIHF1ZXJpZXMgYWxyZWFkeSBydW5uaW5nIGF0IHRoZSByZWNvbm5lY3QgZGVhZGxpbmUgc2V0dGxlXG4gICAqIGJlZm9yZSB3b3JrZXIgaWRzIGFyZSBmaWx0ZXJlZC4gQSBzZWNvbmQgYm91bmRlZCBncmFjZSBwcmV2ZW50cyBhIHN0dWNrXG4gICAqIGFkYXB0ZXIgcXVlcnkgZnJvbSBkZWZlcnJpbmcgc3RhcnR1cCByZWNsYWltIGZvcmV2ZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGRlYWRsaW5lIHNldCBzZXR0bGVzIG9yIHRpbWVzIG91dC5cbiAgICovXG4gIGFzeW5jIF93YWl0Rm9yU3RhcnR1cEhhbmRvZmZBZG9wdGlvbnNBdERlYWRsaW5lKCkge1xuICAgIGNvbnN0IGFkb3B0aW9ucyA9IHRoaXMuX3N0YXJ0dXBIYW5kb2ZmQWRvcHRpb25zQXREZWFkbGluZVxuXG4gICAgdGhpcy5fc3RhcnR1cEhhbmRvZmZBZG9wdGlvbnNBdERlYWRsaW5lID0gW11cbiAgICBpZiAoYWRvcHRpb25zLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCB0aW1lclxuICAgIGNvbnN0IHdhaXRMaW1pdCA9IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICAvLyBUaGlzIGxpZmVjeWNsZSBkZWFkbGluZSBtdXN0IG5vdCBrZWVwIHRoZSBtYWluIHByb2Nlc3MgYWxpdmU7IHRoZVxuICAgICAgLy8gZ2VuZXJpYyB0aW1lb3V0IGhlbHBlciBpbnRlbnRpb25hbGx5IHVzZXMgYSByZWZlcmVuY2VkIHRpbWVyLlxuICAgICAgdGltZXIgPSBzZXRUaW1lb3V0KHJlc29sdmUsIHRoaXMud29ya2VyUmVjb25uZWN0R3JhY2VNcylcbiAgICAgIHRpbWVyLnVucmVmKClcbiAgICB9KVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IFByb21pc2UucmFjZShbUHJvbWlzZS5hbGwoYWRvcHRpb25zKSwgd2FpdExpbWl0XSlcbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKHRpbWVyKSBjbGVhclRpbWVvdXQodGltZXIpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFB1Ymxpc2hlcyBhIGRpc3BhdGNoIHdha2UtdXAgb24gdGhlIEJlYWNvbiBjaGFubmVsLiBOby1vcCBpbiBwb2xsaW5nXG4gICAqIG1vZGUgb3Igd2hlbiBCZWFjb24gaXMgbm90IGNvbm5lY3RlZDsgaW4gdGhvc2UgY2FzZXMgdGhlIGRpcmVjdFxuICAgKiBpbi1wcm9jZXNzIGBfZHJhaW4oKWAgY2FsbCBpbiB0aGUgZW5xdWV1ZS9oYW5kbGUgcGF0aHMgaXMgc3VmZmljaWVudFxuICAgKiAodGhlcmUgYXJlIG5vIG90aGVyIHByb2Nlc3NlcyB0byBub3RpZnkpLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9ub3RpZnlFbnF1ZXVlZCgpIHtcbiAgICBpZiAodGhpcy5kaXNwYXRjaFN0cmF0ZWd5ID09PSBcInBvbGxpbmdcIikgcmV0dXJuXG5cbiAgICBjb25zdCBiZWFjb25DbGllbnQgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmVhY29uQ2xpZW50KClcbiAgICBpZiAoIWJlYWNvbkNsaWVudCB8fCAhYmVhY29uQ2xpZW50LmlzQ29ubmVjdGVkKCkpIHJldHVyblxuXG4gICAgdHJ5IHtcbiAgICAgIGJlYWNvbkNsaWVudC5wdWJsaXNoKHtcbiAgICAgICAgY2hhbm5lbDogRElTUEFUQ0hfQ0hBTk5FTCxcbiAgICAgICAgYnJvYWRjYXN0UGFyYW1zOiB7fSxcbiAgICAgICAgYm9keToge2FjdGlvbjogXCJ3YWtlXCJ9XG4gICAgICB9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKCgpID0+IFtcIkZhaWxlZCB0byBwdWJsaXNoIGJhY2tncm91bmQgam9icyB3YWtlIGJyb2FkY2FzdDpcIiwgZXJyb3JdKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5ldFwiKS5Tb2NrZXR9IHNvY2tldCAtIFNvY2tldC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaGFuZGxlQ29ubmVjdGlvbihzb2NrZXQpIHtcbiAgICBjb25zdCBqc29uU29ja2V0ID0gbmV3IEpzb25Tb2NrZXQoc29ja2V0KVxuICAgIHRoaXMuY29ubmVjdGlvbnMuYWRkKGpzb25Tb2NrZXQpXG4gICAgLyoqXG4gICAgICogUm9sZS5cbiAgICAgKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU29ja2V0Um9sZSB8IG51bGx9ICovXG4gICAgbGV0IHJvbGUgPSBudWxsXG5cbiAgICBsZXQgY2xlYW5lZFVwID0gZmFsc2VcbiAgICBjb25zdCBjbGVhbnVwID0gKCkgPT4ge1xuICAgICAgaWYgKGNsZWFuZWRVcCkgcmV0dXJuXG4gICAgICBjbGVhbmVkVXAgPSB0cnVlXG4gICAgICB0aGlzLmNvbm5lY3Rpb25zLmRlbGV0ZShqc29uU29ja2V0KVxuXG4gICAgICBpZiAocm9sZSA9PT0gXCJ3b3JrZXJcIikgdm9pZCB0aGlzLl9oYW5kbGVXb3JrZXJTb2NrZXRDbG9zZWQoanNvblNvY2tldClcbiAgICAgIHRoaXMuX21heWJlU3RvcFJldGlyZWQoKVxuICAgIH1cblxuICAgIGpzb25Tb2NrZXQub24oXCJjbG9zZVwiLCBjbGVhbnVwKVxuICAgIGpzb25Tb2NrZXQub24oXCJlcnJvclwiLCAoZXJyb3IpID0+IHtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oKCkgPT4gW1wiQmFja2dyb3VuZCBqb2JzIGNvbm5lY3Rpb24gZXJyb3I6XCIsIGVycm9yXSlcbiAgICAgIGNsZWFudXAoKVxuICAgIH0pXG5cbiAgICBsZXQgbWVzc2FnZUhhbmRsaW5nID0gUHJvbWlzZS5yZXNvbHZlKClcbiAgICBqc29uU29ja2V0Lm9uKFwibWVzc2FnZVwiLCAobWVzc2FnZSkgPT4ge1xuICAgICAgbWVzc2FnZUhhbmRsaW5nID0gbWVzc2FnZUhhbmRsaW5nLnRoZW4oYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBleGlzdGluZ1JvbGUgPSByb2xlXG4gICAgICAgIHJvbGUgPSBhd2FpdCB0aGlzLl9oYW5kbGVTb2NrZXRNZXNzYWdlKHtqc29uU29ja2V0LCBtZXNzYWdlLCByb2xlfSlcbiAgICAgICAgaWYgKGV4aXN0aW5nUm9sZSA9PT0gXCJjbGllbnRcIiB8fCBleGlzdGluZ1JvbGUgPT09IFwicmVwb3J0ZXJcIikganNvblNvY2tldC5jbG9zZSgpXG4gICAgICB9KS5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgICAgdGhpcy5fcmVwb3J0Q29ubmVjdGlvbkhhbmRsZXJFcnJvcihlcnJvcilcbiAgICAgICAganNvblNvY2tldC5jbG9zZSgpXG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogU3VyZmFjZXMgYW4gdW5leHBlY3RlZCBwcm90b2NvbC1oYW5kbGVyIGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gSGFuZGxlciBmYWlsdXJlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXBvcnRDb25uZWN0aW9uSGFuZGxlckVycm9yKGVycm9yKSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG4gICAgY29uc3QgcGF5bG9hZCA9IHtjb250ZXh0OiB7c3RhZ2U6IFwiYmFja2dyb3VuZC1qb2JzLXNvY2tldC1oYW5kbGVyXCJ9LCBlcnJvcjogbm9ybWFsaXplZEVycm9yfVxuICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIkJhY2tncm91bmQgam9icyBzb2NrZXQgaGFuZGxlciBmYWlsZWQ6XCIsIG5vcm1hbGl6ZWRFcnJvcl0pXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgc29ja2V0IG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLmpzb25Tb2NrZXQgLSBKU09OIHNvY2tldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTb2NrZXRNZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBTb2NrZXQgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTb2NrZXRSb2xlIHwgbnVsbH0gYXJncy5yb2xlIC0gQ3VycmVudCBzb2NrZXQgcm9sZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU29ja2V0Um9sZSB8IG51bGw+fSAtIFVwZGF0ZWQgc29ja2V0IHJvbGUuXG4gICAqL1xuICBhc3luYyBfaGFuZGxlU29ja2V0TWVzc2FnZSh7anNvblNvY2tldCwgbWVzc2FnZSwgcm9sZX0pIHtcbiAgICBpZiAoIXJvbGUpIHJldHVybiBhd2FpdCB0aGlzLl9oYW5kbGVSb2xlbGVzc1NvY2tldE1lc3NhZ2Uoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KVxuICAgIGlmIChyb2xlID09PSBcIndvcmtlclwiKSB7XG4gICAgICBhd2FpdCB0aGlzLl9oYW5kbGVXb3JrZXJTb2NrZXRNZXNzYWdlKHtqc29uU29ja2V0LCBtZXNzYWdlfSlcbiAgICAgIHJldHVybiByb2xlXG4gICAgfVxuXG4gICAgdGhpcy5fYWN0aXZlTm9uV29ya2VyUmVxdWVzdHMgKz0gMVxuICAgIHRyeSB7XG4gICAgICBpZiAocm9sZSA9PT0gXCJjbGllbnRcIikgYXdhaXQgdGhpcy5faGFuZGxlQ2xpZW50U29ja2V0TWVzc2FnZSh7anNvblNvY2tldCwgbWVzc2FnZX0pXG4gICAgICBpZiAocm9sZSA9PT0gXCJyZXBvcnRlclwiKSBhd2FpdCB0aGlzLl9oYW5kbGVSZXBvcnRlclNvY2tldE1lc3NhZ2Uoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl9hY3RpdmVOb25Xb3JrZXJSZXF1ZXN0cyAtPSAxXG4gICAgICB0aGlzLl9tYXliZVN0b3BSZXRpcmVkKClcbiAgICB9XG5cbiAgICByZXR1cm4gcm9sZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIHJvbGVsZXNzIHNvY2tldCBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy5qc29uU29ja2V0IC0gSlNPTiBzb2NrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU29ja2V0TWVzc2FnZX0gYXJncy5tZXNzYWdlIC0gU29ja2V0IG1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNvY2tldFJvbGUgfCBudWxsPn0gLSBOZXcgc29ja2V0IHJvbGUuXG4gICAqL1xuICBhc3luYyBfaGFuZGxlUm9sZWxlc3NTb2NrZXRNZXNzYWdlKHtqc29uU29ja2V0LCBtZXNzYWdlfSkge1xuICAgIGlmIChtZXNzYWdlPy50eXBlICE9PSBcImhlbGxvXCIpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCByZWplY3Rpb25SZWFzb24gPSB0aGlzLl9nZW5lcmF0aW9uSGVsbG9SZWplY3Rpb25SZWFzb24obWVzc2FnZSlcblxuICAgIGlmIChyZWplY3Rpb25SZWFzb24pIHtcbiAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJnZW5lcmF0aW9uLXJlamVjdGVkXCIsIHJlYXNvbjogcmVqZWN0aW9uUmVhc29ufSlcbiAgICAgIGpzb25Tb2NrZXQuY2xvc2UoKVxuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG5cbiAgICBpZiAobWVzc2FnZS5yb2xlID09PSBcIndvcmtlclwiKSB7XG4gICAgICBpZiAodGhpcy5fc3RvcHBlZCkge1xuICAgICAgICBqc29uU29ja2V0LmNsb3NlKClcbiAgICAgICAgcmV0dXJuIG1lc3NhZ2Uucm9sZVxuICAgICAgfVxuXG4gICAgICBpZiAoIShhd2FpdCB0aGlzLl9yZWdpc3Rlcldvcmtlcih7anNvblNvY2tldCwgbWVzc2FnZX0pKSkgcmV0dXJuIG51bGxcbiAgICB9XG5cbiAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQpIHtcbiAgICAgIGpzb25Tb2NrZXQuc2VuZCh7XG4gICAgICAgIHR5cGU6IFwiZ2VuZXJhdGlvbi1hY2NlcHRlZFwiLFxuICAgICAgICBnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkLFxuICAgICAgICBsaWZlY3ljbGVTdGF0ZTogdGhpcy5saWZlY3ljbGVTdGF0ZVxuICAgICAgfSlcbiAgICAgIGlmIChtZXNzYWdlLnJvbGUgPT09IFwid29ya2VyXCIgJiYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwicmV0aXJpbmdcIiB8fCB0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcInJldGlyZWRcIikpIHtcbiAgICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcInJldGlyZVwiLCBnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkfSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbWVzc2FnZS5yb2xlXG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIHRoZSBnZW5lcmF0aW9uIGZlbmNlIGJlZm9yZSBhc3NpZ25pbmcgYSBzb2NrZXQgcm9sZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JIZWxsb01lc3NhZ2V9IG1lc3NhZ2UgLSBIZWxsbyBtZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25SZWplY3Rpb25SZWFzb24gfCBudWxsfSAtIFJlamVjdGlvbiByZWFzb24uXG4gICAqL1xuICBfZ2VuZXJhdGlvbkhlbGxvUmVqZWN0aW9uUmVhc29uKG1lc3NhZ2UpIHtcbiAgICBjb25zdCBtZXNzYWdlSGFzR2VuZXJhdGlvbiA9IE9iamVjdC5oYXNPd24obWVzc2FnZSwgXCJnZW5lcmF0aW9uSWRcIilcblxuICAgIGlmICghdGhpcy5nZW5lcmF0aW9uSWQpIHJldHVybiBtZXNzYWdlSGFzR2VuZXJhdGlvbiA/IFwidW5leHBlY3RlZC1nZW5lcmF0aW9uXCIgOiBudWxsXG4gICAgaWYgKCFtZXNzYWdlSGFzR2VuZXJhdGlvbikgcmV0dXJuIFwibWlzc2luZy1nZW5lcmF0aW9uXCJcblxuICAgIHRyeSB7XG4gICAgICB2YWxpZGF0ZUdlbmVyYXRpb25JZChtZXNzYWdlLmdlbmVyYXRpb25JZCwgXCJoZWxsbyBnZW5lcmF0aW9uSWRcIilcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBcIm1hbGZvcm1lZC1nZW5lcmF0aW9uXCJcbiAgICB9XG5cbiAgICBpZiAobWVzc2FnZS5nZW5lcmF0aW9uSWQgIT09IHRoaXMuZ2VuZXJhdGlvbklkKSByZXR1cm4gXCJnZW5lcmF0aW9uLW1pc21hdGNoXCJcbiAgICBpZiAobWVzc2FnZS5yb2xlID09PSBcIndvcmtlclwiICYmICF3b3JrZXJJZEJlbG9uZ3NUb0dlbmVyYXRpb24oe2dlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWQsIHdvcmtlcklkOiBtZXNzYWdlLndvcmtlcklkfSkpIHtcbiAgICAgIHJldHVybiBcImdlbmVyYXRpb24tbWlzbWF0Y2hcIlxuICAgIH1cblxuICAgIHJldHVybiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGEgZ2VuZXJhdGlvbi1mZW5jZWQgd29ya2VyIGFuZCB0cmFuc2ZlcnMgb25seSBpdHMgZXhhY3Qgb3duZXJzaGlwLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFdvcmtlciBoZWxsby5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLmpzb25Tb2NrZXQgLSBOZXcgc29ja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhlbGxvTWVzc2FnZX0gYXJncy5tZXNzYWdlIC0gSGVsbG8uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIHdvcmtlciB3YXMgYWRtaXR0ZWQuXG4gICAqL1xuICBhc3luYyBfcmVnaXN0ZXJXb3JrZXIoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KSB7XG4gICAganNvblNvY2tldC53b3JrZXJJZCA9IG1lc3NhZ2Uud29ya2VySWRcbiAgICBqc29uU29ja2V0LnN1cHBvcnRzSGFuZG9mZklkUmVwb3J0aW5nID0gbWVzc2FnZS5zdXBwb3J0c0hhbmRvZmZJZFJlcG9ydGluZyA9PT0gdHJ1ZVxuICAgIGpzb25Tb2NrZXQuc3VwcG9ydHNIZWFydGJlYXQgPSBtZXNzYWdlLnN1cHBvcnRzSGVhcnRiZWF0ID09PSB0cnVlXG4gICAganNvblNvY2tldC5sYXN0U2VlbkF0ID0gdGhpcy5jbG9jay5ub3coKVxuXG4gICAgY29uc3Qgd29ya2VySWQgPSBqc29uU29ja2V0LndvcmtlcklkXG4gICAgY29uc3QgZGlzY29ubmVjdGVkID0gd29ya2VySWQgPyB0aGlzLmRpc2Nvbm5lY3RlZFdvcmtlcnMuZ2V0KHdvcmtlcklkKSA6IHVuZGVmaW5lZFxuICAgIGxldCBoYW5kb2ZmcyA9IGRpc2Nvbm5lY3RlZCA/IHRoaXMud29ya2VySGFuZG9mZnMuZ2V0KGRpc2Nvbm5lY3RlZC53b3JrZXIpIDogdW5kZWZpbmVkXG4gICAgY29uc3QgcmVjb3ZlcnlPbmx5ID0gdGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJyZXRpcmluZ1wiIHx8IHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwicmV0aXJlZFwiXG5cbiAgICBpZiAocmVjb3ZlcnlPbmx5ICYmICghaGFuZG9mZnMgfHwgaGFuZG9mZnMuc2l6ZSA9PT0gMCkpIHtcbiAgICAgIGlmICghd29ya2VySWQpIHJldHVybiBmYWxzZVxuICAgICAgY29uc3QgZHVyYWJsZUhhbmRvZmZzID0gYXdhaXQgdGhpcy5zdG9yZS5oYW5kZWRPZmZKb2JzRm9yV29ya2VyKHt3b3JrZXJJZH0pXG5cbiAgICAgIGlmIChkdXJhYmxlSGFuZG9mZnMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJnZW5lcmF0aW9uLXJlamVjdGVkXCIsIHJlYXNvbjogXCJ3b3JrZXItaGFzLW5vLXJlY292ZXJhYmxlLWhhbmRvZmZzXCJ9KVxuICAgICAgICBqc29uU29ja2V0LmNsb3NlKClcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG5cbiAgICAgIGhhbmRvZmZzID0gbmV3IE1hcChkdXJhYmxlSGFuZG9mZnMubWFwKCh7am9iSWQsIGhhbmRvZmZJZH0pID0+IFtqb2JJZCwgaGFuZG9mZklkXSkpXG4gICAgICB0aGlzLnJlY29ubmVjdGVkV29ya2VySWRzLmFkZCh3b3JrZXJJZClcbiAgICB9XG5cbiAgICBpZiAoZGlzY29ubmVjdGVkKSB7XG4gICAgICB0aGlzLmNsb2NrLmNsZWFyVGltZW91dChkaXNjb25uZWN0ZWQudGltZXIpXG4gICAgICBpZiAod29ya2VySWQpIHRoaXMuZGlzY29ubmVjdGVkV29ya2Vycy5kZWxldGUod29ya2VySWQpXG4gICAgICB0aGlzLndvcmtlckhhbmRvZmZzLmRlbGV0ZShkaXNjb25uZWN0ZWQud29ya2VyKVxuICAgIH1cblxuICAgIHRoaXMud29ya2Vycy5hZGQoanNvblNvY2tldClcbiAgICB0aGlzLndvcmtlckhhbmRvZmZzLnNldChqc29uU29ja2V0LCBoYW5kb2ZmcyB8fCBuZXcgTWFwKCkpXG4gICAgaWYgKHJlY292ZXJ5T25seSkganNvblNvY2tldC5pc0RyYWluaW5nID0gdHJ1ZVxuICAgIGlmICghaGFuZG9mZnMgJiYgdGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJhY3RpdmVcIikgdGhpcy5fdHJhY2tXb3JrZXJIYW5kb2ZmQWRvcHRpb24oanNvblNvY2tldClcblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogVHJhY2tzIGEgd29ya2VyIGhhbmRvZmYtYWRvcHRpb24gcXVlcnkgdGhyb3VnaCBzaHV0ZG93bi5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBqc29uU29ja2V0IC0gUmVjb25uZWN0aW5nIHdvcmtlciBzb2NrZXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3RyYWNrV29ya2VySGFuZG9mZkFkb3B0aW9uKGpzb25Tb2NrZXQpIHtcbiAgICBjb25zdCBhZG9wdGlvbiA9IHRoaXMuX2Fkb3B0V29ya2VySGFuZG9mZnMoanNvblNvY2tldClcbiAgICB0aGlzLmluZmxpZ2h0V29ya2VySGFuZG9mZkFkb3B0aW9ucy5hZGQoYWRvcHRpb24pXG4gICAgY29uc3QgcmVtb3ZlQWRvcHRpb24gPSAoKSA9PiB7XG4gICAgICB0aGlzLmluZmxpZ2h0V29ya2VySGFuZG9mZkFkb3B0aW9ucy5kZWxldGUoYWRvcHRpb24pXG4gICAgICB0aGlzLl9tYXliZVN0b3BSZXRpcmVkKClcbiAgICB9XG4gICAgdm9pZCBhZG9wdGlvbi50aGVuKHJlbW92ZUFkb3B0aW9uLCByZW1vdmVBZG9wdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBXYWl0cyBmb3Igd29ya2VyIGhhbmRvZmYtYWRvcHRpb24gcXVlcmllcyB0byBmaW5pc2guXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gbm8gYWRvcHRpb24gcXVlcnkgcmVtYWlucy5cbiAgICovXG4gIGFzeW5jIF9kcmFpbldvcmtlckhhbmRvZmZBZG9wdGlvbnMoKSB7XG4gICAgd2hpbGUgKHRoaXMuaW5mbGlnaHRXb3JrZXJIYW5kb2ZmQWRvcHRpb25zLnNpemUgPiAwKSB7XG4gICAgICBhd2FpdCBQcm9taXNlLmFsbChbLi4udGhpcy5pbmZsaWdodFdvcmtlckhhbmRvZmZBZG9wdGlvbnNdKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBZG9wdHMgYSByZWNvbm5lY3Rpbmcgd29ya2VyJ3Mgc3RpbGwtYWN0aXZlIGBoYW5kZWRfb2ZmYCBqb2JzIGludG8gaXRzIG5ld1xuICAgKiBzb2NrZXQncyBoYW5kb2ZmIG1hcC4gQSBmcmVzaCBtYWluIChlLmcuIGFmdGVyIGEgZGVwbG95IHJlc3RhcnQpIGhvbGRzIG5vXG4gICAqIGluLW1lbW9yeSBsZWFzZXMsIHNvIGEgd29ya2VyIHRoYXQgcmVjb25uZWN0cyB3aXRoIGl0cyBzdGFibGUgaWQgd291bGRcbiAgICogb3RoZXJ3aXNlIGhhdmUgaXRzIHByZS1yZXN0YXJ0IGpvYnMgdHJhY2tlZCBub3doZXJlIOKAlCBpZiBpdCB0aGVuIGRpZWQsIHRob3NlXG4gICAqIGxlYXNlcyAoYW5kIHRoZWlyIGNvbmN1cnJlbmN5IHJlc2VydmF0aW9ucykgd291bGQgc2l0IHN0dWNrIHVudGlsIHRoZVxuICAgKiBob3Vycy1sb25nIG9ycGhhbiBzd2VlcC4gQWRvcHRpbmcgdGhlbSBtZWFucyBgX2hhbmRsZVdvcmtlclNvY2tldENsb3NlZGBcbiAgICogcmVsZWFzZXMgdGhlbSBvbiB0aGUgd29ya2VyJ3MgbmV4dCBkaXNjb25uZWN0LCB3aGlsZSBhIHN0aWxsLXJ1bm5pbmcgd29ya2VyXG4gICAqIChpbmNsdWRpbmcgb25lIGdyYWNlZnVsbHkgZHJhaW5pbmcpIGtlZXBzIGV4ZWN1dGluZyB0aGVtIHVudG91Y2hlZC4gTm9cbiAgICogdGltZS1iYXNlZCByZWNsYWltIGlzIHVzZWQsIHNvIGEgZHJhaW5pbmcgd29ya2VyIHdob3NlIGpvYnMgb3V0bGl2ZSB0aGUgb2xkXG4gICAqIG1haW4gaXMgbmV2ZXIgd3JvbmdseSByZXF1ZXVlZCBpbnRvIGEgZHVwbGljYXRlIGF0dGVtcHQuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0ganNvblNvY2tldCAtIFRoZSByZWNvbm5lY3RlZCB3b3JrZXIgc29ja2V0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9hZG9wdFdvcmtlckhhbmRvZmZzKGpzb25Tb2NrZXQpIHtcbiAgICBjb25zdCB3b3JrZXJJZCA9IGpzb25Tb2NrZXQud29ya2VySWRcblxuICAgIGlmICh0eXBlb2Ygd29ya2VySWQgIT09IFwic3RyaW5nXCIgfHwgd29ya2VySWQubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBoYW5kb2ZmcyA9IGF3YWl0IHRoaXMuc3RvcmUuaGFuZGVkT2ZmSm9ic0Zvcldvcmtlcih7d29ya2VySWR9KVxuICAgICAgY29uc3QgbWFwID0gdGhpcy53b3JrZXJIYW5kb2Zmcy5nZXQoanNvblNvY2tldClcblxuICAgICAgLy8gVGhlIHNvY2tldCBtYXkgaGF2ZSBjbG9zZWQgd2hpbGUgdGhlIHF1ZXJ5IHdhcyBpbiBmbGlnaHQ7IGl0cyBtYXAgaXMgdGhlblxuICAgICAgLy8gZ29uZSBhbmQgdGhlIGpvYnMgYXJlIGxlZnQgZm9yIHRoZSBvcnBoYW4gc3dlZXAgcmF0aGVyIHRoYW4gcmVzdXJyZWN0ZWQuXG4gICAgICBpZiAoIW1hcCB8fCAhdGhpcy53b3JrZXJzLmhhcyhqc29uU29ja2V0KSkgcmV0dXJuXG5cbiAgICAgIGZvciAoY29uc3Qge2pvYklkLCBoYW5kb2ZmSWR9IG9mIGhhbmRvZmZzKSB7XG4gICAgICAgIG1hcC5zZXQoam9iSWQsIGhhbmRvZmZJZClcbiAgICAgIH1cbiAgICAgIHRoaXMucmVjb25uZWN0ZWRXb3JrZXJJZHMuYWRkKHdvcmtlcklkKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLl9yZXBvcnRIYW5kb2ZmQWRvcHRFcnJvcihlcnJvcilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgY2xpZW50IHNvY2tldCBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy5qc29uU29ja2V0IC0gSlNPTiBzb2NrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU29ja2V0TWVzc2FnZX0gYXJncy5tZXNzYWdlIC0gU29ja2V0IG1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSByZXF1ZXN0IGlzIGFja25vd2xlZGdlZC5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVDbGllbnRTb2NrZXRNZXNzYWdlKHtqc29uU29ja2V0LCBtZXNzYWdlfSkge1xuICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCAmJiAodGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJyZXRpcmluZ1wiIHx8IHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwicmV0aXJlZFwiKSkge1xuICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiZW5xdWV1ZVwiICYmICFtZXNzYWdlLnByb2R1Y2VyUHJvb2YpIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJlbnF1ZXVlLWVycm9yXCIsIGVycm9yOiBcIkJhY2tncm91bmQgam9icyBnZW5lcmF0aW9uIGlzIHJldGlyZWRcIn0pXG4gICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJyZXBsYWNlLXNjaGVkdWxlZFwiKSBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwicmVwbGFjZS1zY2hlZHVsZWQtZXJyb3JcIiwgZXJyb3I6IFwiQmFja2dyb3VuZCBqb2JzIGdlbmVyYXRpb24gaXMgcmV0aXJlZFwifSlcbiAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImNhbmNlbC1zY2hlZHVsZWRcIikganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImNhbmNlbC1zY2hlZHVsZWQtZXJyb3JcIiwgZXJyb3I6IFwiQmFja2dyb3VuZCBqb2JzIGdlbmVyYXRpb24gaXMgcmV0aXJlZFwifSlcbiAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImdldC1zY2hlZHVsZWQtam9iXCIpIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJnZXQtc2NoZWR1bGVkLWpvYi1lcnJvclwiLCBlcnJvcjogXCJCYWNrZ3JvdW5kIGpvYnMgZ2VuZXJhdGlvbiBpcyByZXRpcmVkXCJ9KVxuICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwid2FrZS1zY2hlZHVsZWRcIikganNvblNvY2tldC5zZW5kKHt0eXBlOiBcIndha2Utc2NoZWR1bGVkLWVycm9yXCIsIGVycm9yOiBcIkJhY2tncm91bmQgam9icyBnZW5lcmF0aW9uIGlzIHJldGlyZWRcIn0pXG4gICAgICBpZiAobWVzc2FnZT8udHlwZSAhPT0gXCJlbnF1ZXVlXCIgfHwgIW1lc3NhZ2UucHJvZHVjZXJQcm9vZikgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiZW5xdWV1ZVwiKSB7XG4gICAgICBhd2FpdCB0aGlzLl9oYW5kbGVFbnF1ZXVlKHtqc29uU29ja2V0LCBtZXNzYWdlfSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcInJlcGxhY2Utc2NoZWR1bGVkXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZVJlcGxhY2VTY2hlZHVsZWQoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiY2FuY2VsLXNjaGVkdWxlZFwiKSB7XG4gICAgICBhd2FpdCB0aGlzLl9oYW5kbGVDYW5jZWxTY2hlZHVsZWQoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiZ2V0LXNjaGVkdWxlZC1qb2JcIikge1xuICAgICAgYXdhaXQgdGhpcy5faGFuZGxlR2V0U2NoZWR1bGVkSm9iKHtqc29uU29ja2V0LCBtZXNzYWdlfSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcIndha2Utc2NoZWR1bGVkXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZVdha2VTY2hlZHVsZWQoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSB3b3JrZXIgc29ja2V0IG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLmpzb25Tb2NrZXQgLSBKU09OIHNvY2tldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTb2NrZXRNZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBTb2NrZXQgbWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHdvcmtlciBtZXNzYWdlIGlzIGhhbmRsZWQuXG4gICAqL1xuICBhc3luYyBfaGFuZGxlV29ya2VyU29ja2V0TWVzc2FnZSh7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICAvLyBBbnkgbWVzc2FnZSBmcm9tIHRoZSB3b3JrZXIgcHJvdmVzIGl0IGlzIGFsaXZlOyB0aGUgbGl2ZW5lc3Mgc3dlZXAgdXNlc1xuICAgIC8vIHRoaXMgdG8gZGV0ZWN0IGEgd2VkZ2VkL3NpbGVudCB3b3JrZXIuXG4gICAganNvblNvY2tldC5sYXN0U2VlbkF0ID0gdGhpcy5jbG9jay5ub3coKVxuXG4gICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiaGVhcnRiZWF0XCIpIHtcbiAgICAgIHRoaXMub25Xb3JrZXJIZWFydGJlYXQ/Lihqc29uU29ja2V0KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwicmVhZHlcIikge1xuICAgICAgdGhpcy5faGFuZGxlV29ya2VyUmVhZHkoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiZHJhaW5pbmdcIikge1xuICAgICAgdGhpcy5faGFuZGxlV29ya2VyRHJhaW5pbmcoe2pzb25Tb2NrZXR9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5faGFuZGxlUmVwb3J0ZXJTb2NrZXRNZXNzYWdlKHtqc29uU29ja2V0LCBtZXNzYWdlfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSByZXBvcnRlciBzb2NrZXQgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNvY2tldE1lc3NhZ2V9IGFyZ3MubWVzc2FnZSAtIFNvY2tldCBtZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgcmVwb3J0IGlzIGFja25vd2xlZGdlZC5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVSZXBvcnRlclNvY2tldE1lc3NhZ2Uoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KSB7XG4gICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkICYmIHRoaXMuX2dlbmVyYXRpb25SZXBvcnRJc0ludmFsaWQobWVzc2FnZSkpIHtcbiAgICAgIGlmIChcImpvYklkXCIgaW4gbWVzc2FnZSAmJiB0eXBlb2YgbWVzc2FnZS5qb2JJZCA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiam9iLXVwZGF0ZS1lcnJvclwiLCBqb2JJZDogbWVzc2FnZS5qb2JJZCwgZXJyb3I6IFwiR2VuZXJhdGlvbiBvd25lcnNoaXAgcmVqZWN0ZWRcIn0pXG4gICAgICB9XG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiam9iLWFjY2VwdGVkXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZUpvYkFjY2VwdGVkKHtqc29uU29ja2V0LCBtZXNzYWdlfSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImpvYi1jb21wbGV0ZVwiKSB7XG4gICAgICBhd2FpdCB0aGlzLl9oYW5kbGVKb2JDb21wbGV0ZSh7anNvblNvY2tldCwgbWVzc2FnZX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJqb2ItZmFpbGVkXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZUpvYkZhaWxlZCh7anNvblNvY2tldCwgbWVzc2FnZX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJqb2ItcmVzY2hlZHVsZVwiKSB7XG4gICAgICBhd2FpdCB0aGlzLl9oYW5kbGVKb2JSZXNjaGVkdWxlKHtqc29uU29ja2V0LCBtZXNzYWdlfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUGVyc2lzdHMgcG9vbGVkLWNoaWxkIGFjY2VwdGFuY2UgZXZpZGVuY2UgZm9yIGFuIGFjdGl2ZSBoYW5kb2ZmLiBUaGVcbiAgICogcmVwb3J0IGlzIGRpYWdub3N0aWM6IGEgc3RhbGUgbGVhc2UgKGpvYiBhbHJlYWR5IHJlY2xhaW1lZCBvciB0ZXJtaW5hbClcbiAgICogYW5zd2VycyB0aGUgc2FtZSBgam9iLXVwZGF0ZWRgIGFja25vd2xlZGdlbWVudCBhcyBhbiBhY2NlcHRlZCByZXBvcnQsIGFuZFxuICAgKiBvbmx5IGEgc3RvcmUgZmFpbHVyZSBhbnN3ZXJzIGBqb2ItdXBkYXRlLWVycm9yYCBzbyB0aGUgd29ya2VyIGNhbiByZXRyeS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkFjY2VwdGVkTWVzc2FnZX0gYXJncy5tZXNzYWdlIC0gTWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBoYW5kbGVkLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZUpvYkFjY2VwdGVkKHtqc29uU29ja2V0LCBtZXNzYWdlfSkge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnN0b3JlLm1hcmtDaGlsZEFjY2VwdGVkKHtcbiAgICAgICAgY2hpbGRJbnN0YW5jZUlkOiBtZXNzYWdlLmNoaWxkSW5zdGFuY2VJZCxcbiAgICAgICAgY2hpbGRQaWQ6IG1lc3NhZ2UuY2hpbGRQaWQsXG4gICAgICAgIGhhbmRlZE9mZkF0TXM6IG1lc3NhZ2UuaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgaGFuZG9mZklkOiBtZXNzYWdlLmhhbmRvZmZJZCxcbiAgICAgICAgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsXG4gICAgICAgIHJlY2VpdmVkQXRNczogbWVzc2FnZS5yZWNlaXZlZEF0TXMsXG4gICAgICAgIHN0YXJ0ZWRBdE1zOiBtZXNzYWdlLnN0YXJ0ZWRBdE1zLFxuICAgICAgICB3b3JrZXJJZDogbWVzc2FnZS53b3JrZXJJZFxuICAgICAgfSlcbiAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJqb2ItdXBkYXRlZFwiLCBqb2JJZDogbWVzc2FnZS5qb2JJZH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuX3JlcG9ydEpvYlVwZGF0ZUZhaWx1cmUoe2Vycm9yLCBqb2JJZDogbWVzc2FnZS5qb2JJZCwgc3RhZ2U6IFwiYmFja2dyb3VuZC1qb2ItYWNjZXB0ZWRcIn0pXG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiam9iLXVwZGF0ZS1lcnJvclwiLCBqb2JJZDogbWVzc2FnZS5qb2JJZCwgZXJyb3I6IFwiRmFpbGVkIHRvIHVwZGF0ZSBqb2JcIn0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcXVpcmVzIHRoZSBjb21wbGV0ZSBkdXJhYmxlIGxlYXNlIGlkZW50aXR5IGJlZm9yZSBhIGdlbmVyYXRpb24tbW9kZVxuICAgKiByZXBvcnRlciBjYW4gbXV0YXRlIGEgam9iLiBMZWdhY3kgcmVwb3J0ZXJzIGtlZXAgdGhlaXIgcGVybWlzc2l2ZSBwcm90b2NvbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTb2NrZXRNZXNzYWdlfSBtZXNzYWdlIC0gUmVwb3J0ZXIgbWVzc2FnZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgcmVwb3J0IGxhY2tzIGl0cyBleGFjdCBnZW5lcmF0aW9uIGxlYXNlLlxuICAgKi9cbiAgX2dlbmVyYXRpb25SZXBvcnRJc0ludmFsaWQobWVzc2FnZSkge1xuICAgIGlmIChtZXNzYWdlPy50eXBlICE9PSBcImpvYi1hY2NlcHRlZFwiICYmIG1lc3NhZ2U/LnR5cGUgIT09IFwiam9iLWNvbXBsZXRlXCIgJiYgbWVzc2FnZT8udHlwZSAhPT0gXCJqb2ItZmFpbGVkXCIgJiYgbWVzc2FnZT8udHlwZSAhPT0gXCJqb2ItcmVzY2hlZHVsZVwiKSByZXR1cm4gZmFsc2VcbiAgICBjb25zdCBnZW5lcmF0aW9uSWQgPSB0aGlzLmdlbmVyYXRpb25JZFxuICAgIGlmICghZ2VuZXJhdGlvbklkKSByZXR1cm4gZmFsc2VcblxuICAgIHJldHVybiB0eXBlb2YgbWVzc2FnZS5oYW5kb2ZmSWQgIT09IFwic3RyaW5nXCJcbiAgICAgIHx8IHR5cGVvZiBtZXNzYWdlLmhhbmRlZE9mZkF0TXMgIT09IFwibnVtYmVyXCJcbiAgICAgIHx8ICF3b3JrZXJJZEJlbG9uZ3NUb0dlbmVyYXRpb24oe2dlbmVyYXRpb25JZCwgd29ya2VySWQ6IG1lc3NhZ2Uud29ya2VySWR9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIHdvcmtlciByZWFkeS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJlYWR5TWVzc2FnZX0gYXJncy5tZXNzYWdlIC0gUmVhZHkgbWVzc2FnZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaGFuZGxlV29ya2VyUmVhZHkoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KSB7XG4gICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwicmV0aXJpbmdcIiB8fCB0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcInJldGlyZWRcIikge1xuICAgICAgdGhpcy5yZWFkeVdvcmtlcnMuZGVsZXRlKGpzb25Tb2NrZXQpXG4gICAgICB0aGlzLmNhbmRpZGF0ZVJlYWR5V29ya2Vycy5kZWxldGUoanNvblNvY2tldClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGpzb25Tb2NrZXQucmVhZGluZXNzVmVyc2lvbiArPSAxXG4gICAganNvblNvY2tldC5hY2NlcHRzU3Bhd25lZEpvYnMgPSBtZXNzYWdlLmFjY2VwdHNTcGF3bmVkICE9PSBmYWxzZSAmJiBtZXNzYWdlLmFjY2VwdHNGb3JrZWQgIT09IGZhbHNlXG4gICAganNvblNvY2tldC5hY2NlcHRzRm9ya2VkSm9icyA9IG1lc3NhZ2UuYWNjZXB0c0ZvcmtlZCAhPT0gZmFsc2VcbiAgICBqc29uU29ja2V0LmFjY2VwdHNQb29sZWRKb2JzID0gbWVzc2FnZS5hY2NlcHRzUG9vbGVkID09PSB0cnVlXG4gICAgY29uc3QgYXZhaWxhYmxlUG9vbGVkU2xvdHMgPSBtZXNzYWdlLmF2YWlsYWJsZVBvb2xlZFNsb3RzXG4gICAganNvblNvY2tldC51c2VzUG9vbGVkQ2FwYWNpdHlDcmVkaXRzID0gTnVtYmVyLmlzSW50ZWdlcihhdmFpbGFibGVQb29sZWRTbG90cylcbiAgICBqc29uU29ja2V0LmF2YWlsYWJsZVBvb2xlZFNsb3RzID0gTnVtYmVyLmlzSW50ZWdlcihhdmFpbGFibGVQb29sZWRTbG90cykgJiYgYXZhaWxhYmxlUG9vbGVkU2xvdHMgIT09IHVuZGVmaW5lZCAmJiBhdmFpbGFibGVQb29sZWRTbG90cyA+IDBcbiAgICAgID8gYXZhaWxhYmxlUG9vbGVkU2xvdHNcbiAgICAgIDogMFxuICAgIGpzb25Tb2NrZXQuYWNjZXB0c0lubGluZUpvYnMgPSBtZXNzYWdlLmFjY2VwdHNJbmxpbmUgIT09IGZhbHNlXG4gICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwiY2FuZGlkYXRlXCIpIHtcbiAgICAgIHRoaXMucmVhZHlXb3JrZXJzLmRlbGV0ZShqc29uU29ja2V0KVxuICAgICAgaWYgKCFqc29uU29ja2V0LmlzRHJhaW5pbmcpIHRoaXMuY2FuZGlkYXRlUmVhZHlXb3JrZXJzLmFkZChqc29uU29ja2V0KVxuICAgIH0gZWxzZSBpZiAodGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJhY3RpdmVcIiAmJiB0aGlzLl9hY3RpdmVPd25lcnNoaXBSZWFkeSAmJiBqc29uU29ja2V0LnN1cHBvcnRzSGFuZG9mZklkUmVwb3J0aW5nICYmICFqc29uU29ja2V0LmlzRHJhaW5pbmcpIHtcbiAgICAgIHRoaXMucmVhZHlXb3JrZXJzLmFkZChqc29uU29ja2V0KVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnJlYWR5V29ya2Vycy5kZWxldGUoanNvblNvY2tldClcbiAgICAgIHRoaXMuY2FuZGlkYXRlUmVhZHlXb3JrZXJzLmRlbGV0ZShqc29uU29ja2V0KVxuICAgIH1cbiAgICB0aGlzLm9uV29ya2VyUmVhZHk/Lihqc29uU29ja2V0KVxuICAgIHZvaWQgdGhpcy5fZHJhaW4oKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIHdvcmtlciBkcmFpbmluZy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9oYW5kbGVXb3JrZXJEcmFpbmluZyh7anNvblNvY2tldH0pIHtcbiAgICAvLyBUaGUgd29ya2VyIGlzIHNodXR0aW5nIGRvd24gZ3JhY2VmdWxseS4gU3RvcCBkaXNwYXRjaGluZyBuZXcgam9ic1xuICAgIC8vIHRvIGl0IGJ1dCBrZWVwIHRoZSBjb25uZWN0aW9uIGluIGB3b3JrZXJzYCBzbyBhbnkgaW4tZmxpZ2h0IGpvYlxuICAgIC8vIGl0J3Mgc3RpbGwgZHJhaW5pbmcgY2FuIHJlcG9ydCBpdHMgcmVzdWx0LlxuICAgIGpzb25Tb2NrZXQuaXNEcmFpbmluZyA9IHRydWVcbiAgICB0aGlzLnJlYWR5V29ya2Vycy5kZWxldGUoanNvblNvY2tldClcbiAgICB0aGlzLmNhbmRpZGF0ZVJlYWR5V29ya2Vycy5kZWxldGUoanNvblNvY2tldClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZW1vdmVzIGEgbG9zdCB3b3JrZXIgc29ja2V0IGFuZCByZWxlYXNlcyBvbmx5IGxlYXNlcyBkaXNwYXRjaGVkIHRocm91Z2ggaXQuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gd29ya2VyIC0gRGlzY29ubmVjdGVkIHdvcmtlciBzb2NrZXQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBDb29yZGluYXRpb24gb3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5xdWV1ZVJlZHJhaW5dIC0gUXVldWUgYW5vdGhlciBwYXNzIGluc3RlYWQgb2YgYXdhaXRpbmcgdGhlIGFjdGl2ZSBkcmFpbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgaXRzIGFjdGl2ZSBsZWFzZXMgYXJlIHJlbGVhc2VkLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZVdvcmtlclNvY2tldENsb3NlZCh3b3JrZXIsIHtxdWV1ZVJlZHJhaW4gPSBmYWxzZX0gPSB7fSkge1xuICAgIHRoaXMud29ya2Vycy5kZWxldGUod29ya2VyKVxuICAgIHRoaXMucmVhZHlXb3JrZXJzLmRlbGV0ZSh3b3JrZXIpXG4gICAgdGhpcy5jYW5kaWRhdGVSZWFkeVdvcmtlcnMuZGVsZXRlKHdvcmtlcilcblxuICAgIGlmICh0aGlzLl9zdG9wcGVkKSB7XG4gICAgICB0aGlzLndvcmtlckhhbmRvZmZzLmRlbGV0ZSh3b3JrZXIpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBoYW5kb2ZmcyA9IHRoaXMud29ya2VySGFuZG9mZnMuZ2V0KHdvcmtlcilcbiAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQgJiYgd29ya2VyLndvcmtlcklkICYmIGhhbmRvZmZzICYmIGhhbmRvZmZzLnNpemUgPiAwKSB7XG4gICAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuZGlzY29ubmVjdGVkV29ya2Vycy5nZXQod29ya2VyLndvcmtlcklkKVxuICAgICAgaWYgKGV4aXN0aW5nPy53b3JrZXIgPT09IHdvcmtlcikgcmV0dXJuXG4gICAgICBpZiAoZXhpc3RpbmcpIHRoaXMuY2xvY2suY2xlYXJUaW1lb3V0KGV4aXN0aW5nLnRpbWVyKVxuXG4gICAgICBjb25zdCB0aW1lciA9IHRoaXMuY2xvY2suc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIHRoaXMuZGlzY29ubmVjdGVkV29ya2Vycy5kZWxldGUod29ya2VyLndvcmtlcklkIHx8IFwiXCIpXG4gICAgICAgIHZvaWQgdGhpcy5fcmVsZWFzZVdvcmtlckhhbmRvZmZzKHdvcmtlcikudGhlbigoKSA9PiB7XG4gICAgICAgICAgaWYgKHdvcmtlci53b3JrZXJJZCkgdGhpcy5vbldvcmtlckhhbmRvZmZzUmVsZWFzZWQ/Lih3b3JrZXIud29ya2VySWQpXG4gICAgICAgIH0sIChlcnJvcikgPT4ge1xuICAgICAgICAgIHRoaXMuX3JlcG9ydEhhbmRvZmZSZWxlYXNlRXJyb3IoZXJyb3IpXG4gICAgICAgICAgdGhpcy5fc2NoZWR1bGVFcnJvclJldHJ5KClcbiAgICAgICAgfSlcbiAgICAgIH0sIHRoaXMud29ya2VyUmVjb25uZWN0R3JhY2VNcylcbiAgICAgIGlmICh0eXBlb2YgdGltZXIgPT09IFwib2JqZWN0XCIpIHRpbWVyLnVucmVmKClcbiAgICAgIHRoaXMuZGlzY29ubmVjdGVkV29ya2Vycy5zZXQod29ya2VyLndvcmtlcklkLCB7d29ya2VyLCB0aW1lcn0pXG4gICAgICB0aGlzLm9uV29ya2VyRGlzY29ubmVjdGVkPy4od29ya2VyLndvcmtlcklkKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VXb3JrZXJIYW5kb2Zmcyh3b3JrZXIsIHtxdWV1ZVJlZHJhaW59KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLl9yZXBvcnRIYW5kb2ZmUmVsZWFzZUVycm9yKGVycm9yKVxuICAgICAgdGhpcy5fc2NoZWR1bGVFcnJvclJldHJ5KClcbiAgICB9XG4gICAgdGhpcy5fbWF5YmVTdG9wUmV0aXJlZCgpXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgYWxsIGxlYXNlcyBzdGlsbCBvd25lZCBieSBvbmUgZXhhY3Qgd29ya2VyIHNvY2tldC5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSB3b3JrZXIgLSBXb3JrZXIgc29ja2V0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gQ29vcmRpbmF0aW9uIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MucXVldWVSZWRyYWluXSAtIFF1ZXVlIGFub3RoZXIgcGFzcyBpbnN0ZWFkIG9mIGF3YWl0aW5nIHRoZSBhY3RpdmUgZHJhaW4uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGZlbmNlZCByZWxlYXNlcyBhbmQgZGlzcGF0Y2ggd2FrZS11cC5cbiAgICovXG4gIGFzeW5jIF9yZWxlYXNlV29ya2VySGFuZG9mZnMod29ya2VyLCB7cXVldWVSZWRyYWluID0gZmFsc2V9ID0ge30pIHtcbiAgICBjb25zdCBoYW5kb2ZmcyA9IHRoaXMud29ya2VySGFuZG9mZnMuZ2V0KHdvcmtlcilcblxuICAgIGlmICghaGFuZG9mZnMgfHwgaGFuZG9mZnMuc2l6ZSA9PT0gMCkge1xuICAgICAgdGhpcy53b3JrZXJIYW5kb2Zmcy5kZWxldGUod29ya2VyKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBbam9iSWQsIGhhbmRvZmZJZF0gb2YgaGFuZG9mZnMpIHtcbiAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VIYW5kb2ZmKHtoYW5kb2ZmSWQsIGpvYklkLCB3b3JrZXJ9KVxuICAgIH1cblxuICAgIHRoaXMud29ya2VySGFuZG9mZnMuZGVsZXRlKHdvcmtlcilcbiAgICB0aGlzLl9ub3RpZnlFbnF1ZXVlZCgpXG4gICAgaWYgKHF1ZXVlUmVkcmFpbikge1xuICAgICAgdGhpcy5fcmVkcmFpblF1ZXVlZCA9IHRydWVcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwiYWN0aXZlXCIpIGF3YWl0IHRoaXMuX2RyYWluKClcbiAgICB9XG4gICAgdGhpcy5fbWF5YmVTdG9wUmV0aXJlZCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBvbmUgaWRlbXBvdGVudCBjb25kaXRpb25hbCBsZWFzZSByZWxlYXNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmhhbmRvZmZJZCAtIEhhbmRvZmYgbGVhc2UgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3Mud29ya2VyIC0gU29ja2V0IHRoYXQgcmVjZWl2ZWQgdGhlIGxlYXNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgZmVuY2VkIHRyYW5zaXRpb24uXG4gICAqL1xuICBhc3luYyBfcmVsZWFzZUhhbmRvZmYoe2hhbmRvZmZJZCwgam9iSWQsIHdvcmtlcn0pIHtcbiAgICBhd2FpdCB0aGlzLnN0b3JlLm1hcmtSZXR1cm5lZFRvUXVldWUoe2hhbmRvZmZJZCwgam9iSWR9KVxuXG4gICAgY29uc3QgaGFuZG9mZnMgPSB0aGlzLndvcmtlckhhbmRvZmZzLmdldCh3b3JrZXIpXG5cbiAgICBpZiAoaGFuZG9mZnM/LmdldChqb2JJZCkgPT09IGhhbmRvZmZJZCkgaGFuZG9mZnMuZGVsZXRlKGpvYklkKVxuICB9XG5cbiAgLyoqXG4gICAqIEZvcmdldHMgYSBzdWNjZXNzZnVsbHkgcmVwb3J0ZWQgbGVhc2Ugd2l0aG91dCByZWx5aW5nIG9uIHdvcmtlciBpZHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuaGFuZG9mZklkIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2ZvcmdldEhhbmRvZmYoe2hhbmRvZmZJZCwgam9iSWR9KSB7XG4gICAgZm9yIChjb25zdCBbd29ya2VyLCBoYW5kb2Zmc10gb2YgdGhpcy53b3JrZXJIYW5kb2Zmcykge1xuICAgICAgaWYgKGhhbmRvZmZzLmdldChqb2JJZCkgIT09IGhhbmRvZmZJZCkgY29udGludWVcblxuICAgICAgaGFuZG9mZnMuZGVsZXRlKGpvYklkKVxuICAgICAgaWYgKGhhbmRvZmZzLnNpemUgPT09IDAgJiYgIXRoaXMud29ya2Vycy5oYXMod29ya2VyKSkgdGhpcy53b3JrZXJIYW5kb2Zmcy5kZWxldGUod29ya2VyKVxuICAgICAgaWYgKGhhbmRvZmZzLnNpemUgPT09IDAgJiYgd29ya2VyLndvcmtlcklkKSB7XG4gICAgICAgIGNvbnN0IGRpc2Nvbm5lY3RlZCA9IHRoaXMuZGlzY29ubmVjdGVkV29ya2Vycy5nZXQod29ya2VyLndvcmtlcklkKVxuICAgICAgICBpZiAoZGlzY29ubmVjdGVkPy53b3JrZXIgPT09IHdvcmtlcikge1xuICAgICAgICAgIHRoaXMuY2xvY2suY2xlYXJUaW1lb3V0KGRpc2Nvbm5lY3RlZC50aW1lcilcbiAgICAgICAgICB0aGlzLmRpc2Nvbm5lY3RlZFdvcmtlcnMuZGVsZXRlKHdvcmtlci53b3JrZXJJZClcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgdGhpcy5fbWF5YmVTdG9wUmV0aXJlZCgpXG4gICAgICByZXR1cm5cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVwb3J0cyBhbiB1bmV4cGVjdGVkIGxlYXNlLXJlbGVhc2UgZmFpbHVyZSBvbiBmcmFtZXdvcmsgZXJyb3IgY2hhbm5lbHMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gUmVsZWFzZSBmYWlsdXJlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXBvcnRIYW5kb2ZmUmVsZWFzZUVycm9yKGVycm9yKSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG4gICAgY29uc3QgcGF5bG9hZCA9IHtjb250ZXh0OiB7c3RhZ2U6IFwiYmFja2dyb3VuZC1qb2ItaGFuZG9mZi1yZWxlYXNlXCJ9LCBlcnJvcjogbm9ybWFsaXplZEVycm9yfVxuICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIkZhaWxlZCB0byByZWxlYXNlIGRpc2Nvbm5lY3RlZCB3b3JrZXIgaGFuZG9mZnM6XCIsIG5vcm1hbGl6ZWRFcnJvcl0pXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gIH1cblxuICAvKipcbiAgICogUmVwb3J0cyBhbiB1bmV4cGVjdGVkIHdvcmtlci1oYW5kb2ZmIGFkb3B0aW9uIGZhaWx1cmUgb24gZnJhbWV3b3JrIGVycm9yXG4gICAqIGNoYW5uZWxzLiBBIGZhaWxlZCBhZG9wdGlvbiBpcyBub3QgZmF0YWwgKHRoZSB3b3JrZXIncyBqb2JzIHJlbWFpbiBhbmQgYXJlXG4gICAqIHJlY2xhaW1lZCBieSB0aGUgb3JwaGFuIHN3ZWVwKSwgYnV0IG11c3Qgc3VyZmFjZSByYXRoZXIgdGhhbiBiZSBzd2FsbG93ZWQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gQWRvcHRpb24gZmFpbHVyZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVwb3J0SGFuZG9mZkFkb3B0RXJyb3IoZXJyb3IpIHtcbiAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICBjb25zdCBwYXlsb2FkID0ge2NvbnRleHQ6IHtzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi1oYW5kb2ZmLWFkb3B0XCJ9LCBlcnJvcjogbm9ybWFsaXplZEVycm9yfVxuICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIkZhaWxlZCB0byBhZG9wdCByZWNvbm5lY3RlZCB3b3JrZXIgaGFuZG9mZnM6XCIsIG5vcm1hbGl6ZWRFcnJvcl0pXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gIH1cblxuICAvKipcbiAgICogUmVwb3J0cyBhbiB1bmV4cGVjdGVkIHN0YXJ0dXAtc25hcHNob3QgcmVjbGFpbSBmYWlsdXJlIHdoaWxlIHJldGFpbmluZyB0aGVcbiAgICogc25hcHNob3QgZm9yIHRoZSBkaXNwYXRjaGVyJ3MgZXhpc3RpbmcgdHJhbnNpZW50LWVycm9yIHJldHJ5IGxpZmVjeWNsZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBSZWNsYWltIGZhaWx1cmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlcG9ydFN0YXJ0dXBIYW5kb2ZmUmVjbGFpbUVycm9yKGVycm9yKSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG4gICAgY29uc3QgcGF5bG9hZCA9IHtjb250ZXh0OiB7c3RhZ2U6IFwiYmFja2dyb3VuZC1qb2Itc3RhcnR1cC1oYW5kb2ZmLXJlY2xhaW1cIn0sIGVycm9yOiBub3JtYWxpemVkRXJyb3J9XG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiRmFpbGVkIHRvIHJlY2xhaW0gZGlzY29ubmVjdGVkIHN0YXJ0dXAgaGFuZG9mZnM6XCIsIG5vcm1hbGl6ZWRFcnJvcl0pXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgZW5xdWV1ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkVucXVldWVNZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBNZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGhhbmRsZWQuXG4gICAqL1xuICBhc3luYyBfaGFuZGxlRW5xdWV1ZSh7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICB0cnkge1xuICAgICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkXG4gICAgICAgICYmIHR5cGVvZiBtZXNzYWdlLnByb2R1Y2VyUHJvb2Y/LndvcmtlcklkID09PSBcInN0cmluZ1wiXG4gICAgICAgICYmICF3b3JrZXJJZEJlbG9uZ3NUb0dlbmVyYXRpb24oe2dlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWQsIHdvcmtlcklkOiBtZXNzYWdlLnByb2R1Y2VyUHJvb2Yud29ya2VySWR9KSkge1xuICAgICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKFwiQmFja2dyb3VuZCBqb2IgcHJvZHVjZXIgaGFuZG9mZiBiZWxvbmdzIHRvIGFub3RoZXIgZ2VuZXJhdGlvbi5cIiwge1xuICAgICAgICAgIGNvZGU6IFwiYmFja2dyb3VuZC1qb2ItcHJvZHVjZXItZ2VuZXJhdGlvbi1taXNtYXRjaFwiXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJlcXVlc3QgPSB7XG4gICAgICAgIGpvYk5hbWU6IG1lc3NhZ2Uuam9iTmFtZSxcbiAgICAgICAgYXJnczogbWVzc2FnZS5hcmdzIHx8IFtdLFxuICAgICAgICBvcHRpb25zOiBtZXNzYWdlLm9wdGlvbnMgfHwge31cbiAgICAgIH1cbiAgICAgIGNvbnN0IGpvYklkID0gdGhpcy5nZW5lcmF0aW9uSWQgJiYgbWVzc2FnZS5wcm9kdWNlclByb29mXG4gICAgICAgID8gYXdhaXQgdGhpcy5zdG9yZS5lbnF1ZXVlRnJvbU93bmVkSGFuZG9mZih7Li4ucmVxdWVzdCwgcHJvZHVjZXJJbnZvY2F0aW9uSWQ6IG1lc3NhZ2UucHJvZHVjZXJJbnZvY2F0aW9uSWQsIHByb2R1Y2VyUHJvb2Y6IG1lc3NhZ2UucHJvZHVjZXJQcm9vZn0pXG4gICAgICAgIDogYXdhaXQgdGhpcy5zdG9yZS5lbnF1ZXVlKHJlcXVlc3QpXG5cbiAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJlbnF1ZXVlZFwiLCBqb2JJZH0pXG4gICAgICB0aGlzLl9ub3RpZnlFbnF1ZXVlZCgpXG4gICAgICBpZiAodGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJhY3RpdmVcIikgYXdhaXQgdGhpcy5fZHJhaW4oKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLl9oYW5kbGVDbGllbnRNdXRhdGlvbkVycm9yKHtcbiAgICAgICAgY29udGV4dDoge2pvYk5hbWU6IG1lc3NhZ2Uuam9iTmFtZSwgc3RhZ2U6IFwiYmFja2dyb3VuZC1qb2ItZW5xdWV1ZVwifSxcbiAgICAgICAgZXJyb3IsXG4gICAgICAgIGZhbGxiYWNrTWVzc2FnZTogXCJGYWlsZWQgdG8gZW5xdWV1ZSBqb2JcIixcbiAgICAgICAganNvblNvY2tldCxcbiAgICAgICAgbG9nTWVzc2FnZTogXCJGYWlsZWQgdG8gZW5xdWV1ZSBiYWNrZ3JvdW5kIGpvYjpcIixcbiAgICAgICAgcmVzcG9uc2VUeXBlOiBcImVucXVldWUtZXJyb3JcIlxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSGFuZGxlcyBhIHN0YWJsZS1rZXkgcmVwbGFjZW1lbnQgcmVxdWVzdCBhbmQgcmUtYXJtcyBkaXNwYXRjaCBhZnRlcndhcmQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLmpzb25Tb2NrZXQgLSBKU09OIHNvY2tldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSZXBsYWNlU2NoZWR1bGVkTWVzc2FnZX0gYXJncy5tZXNzYWdlIC0gTWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBoYW5kbGVkLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZVJlcGxhY2VTY2hlZHVsZWQoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuc3RvcmUucmVwbGFjZVNjaGVkdWxlZCh7XG4gICAgICAgIHNjaGVkdWxlS2V5OiBtZXNzYWdlLnNjaGVkdWxlS2V5LFxuICAgICAgICBqb2JOYW1lOiBtZXNzYWdlLmpvYk5hbWUsXG4gICAgICAgIGFyZ3M6IG1lc3NhZ2UuYXJncyB8fCBbXSxcbiAgICAgICAgb3B0aW9uczogbWVzc2FnZS5vcHRpb25zIHx8IHt9XG4gICAgICB9KVxuXG4gICAgICB0aGlzLl9ub3RpZnlFbnF1ZXVlZCgpXG4gICAgICBhd2FpdCB0aGlzLl9kcmFpbigpXG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwic2NoZWR1bGUtcmVwbGFjZWRcIiwgLi4ucmVzdWx0fSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5faGFuZGxlQ2xpZW50TXV0YXRpb25FcnJvcih7XG4gICAgICAgIGNvbnRleHQ6IHtqb2JOYW1lOiBtZXNzYWdlLmpvYk5hbWUsIHNjaGVkdWxlS2V5OiBtZXNzYWdlLnNjaGVkdWxlS2V5LCBzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi1yZXBsYWNlLXNjaGVkdWxlZFwifSxcbiAgICAgICAgZXJyb3IsXG4gICAgICAgIGZhbGxiYWNrTWVzc2FnZTogXCJGYWlsZWQgdG8gcmVwbGFjZSBzY2hlZHVsZWQgam9iXCIsXG4gICAgICAgIGpzb25Tb2NrZXQsXG4gICAgICAgIGxvZ01lc3NhZ2U6IFwiRmFpbGVkIHRvIHJlcGxhY2Ugc2NoZWR1bGVkIGJhY2tncm91bmQgam9iOlwiLFxuICAgICAgICByZXNwb25zZVR5cGU6IFwicmVwbGFjZS1zY2hlZHVsZWQtZXJyb3JcIlxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSGFuZGxlcyBhIHN0YWJsZS1rZXkgY2FuY2VsbGF0aW9uIHJlcXVlc3QgYW5kIHJlLWFybXMgZGlzcGF0Y2ggYWZ0ZXJ3YXJkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy5qc29uU29ja2V0IC0gSlNPTiBzb2NrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iQ2FuY2VsU2NoZWR1bGVkTWVzc2FnZX0gYXJncy5tZXNzYWdlIC0gTWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBoYW5kbGVkLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZUNhbmNlbFNjaGVkdWxlZCh7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5zdG9yZS5jYW5jZWxTY2hlZHVsZWQobWVzc2FnZS5zY2hlZHVsZUtleSlcblxuICAgICAgdGhpcy5fbm90aWZ5RW5xdWV1ZWQoKVxuICAgICAgYXdhaXQgdGhpcy5fZHJhaW4oKVxuICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcInNjaGVkdWxlLWNhbmNlbGxlZFwiLCAuLi5yZXN1bHR9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLl9oYW5kbGVDbGllbnRNdXRhdGlvbkVycm9yKHtcbiAgICAgICAgY29udGV4dDoge3NjaGVkdWxlS2V5OiBtZXNzYWdlLnNjaGVkdWxlS2V5LCBzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi1jYW5jZWwtc2NoZWR1bGVkXCJ9LFxuICAgICAgICBlcnJvcixcbiAgICAgICAgZmFsbGJhY2tNZXNzYWdlOiBcIkZhaWxlZCB0byBjYW5jZWwgc2NoZWR1bGVkIGpvYlwiLFxuICAgICAgICBqc29uU29ja2V0LFxuICAgICAgICBsb2dNZXNzYWdlOiBcIkZhaWxlZCB0byBjYW5jZWwgc2NoZWR1bGVkIGJhY2tncm91bmQgam9iOlwiLFxuICAgICAgICByZXNwb25zZVR5cGU6IFwiY2FuY2VsLXNjaGVkdWxlZC1lcnJvclwiXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGVzIGEgc3RhYmxlIHNjaGVkdWxlIGxvb2t1cCBhbmQgcmV0dXJucyBvbmx5IG5vcm1hbGl6ZWQgYWRhcHRlciBqb2JzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy5qc29uU29ja2V0IC0gSlNPTiBzb2NrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iR2V0U2NoZWR1bGVkTWVzc2FnZX0gYXJncy5tZXNzYWdlIC0gTWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBoYW5kbGVkLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZUdldFNjaGVkdWxlZEpvYih7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5zdG9yZS5nZXRTY2hlZHVsZWRKb2IobWVzc2FnZS5zY2hlZHVsZUtleSwge1xuICAgICAgICBpbmNsdWRlTGF0ZXN0VGVybWluYWw6IG1lc3NhZ2UuaW5jbHVkZUxhdGVzdFRlcm1pbmFsXG4gICAgICB9KVxuXG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwic2NoZWR1bGVkLWpvYlwiLCAuLi5yZXN1bHR9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLl9oYW5kbGVDbGllbnRNdXRhdGlvbkVycm9yKHtcbiAgICAgICAgY29udGV4dDoge3NjaGVkdWxlS2V5OiBtZXNzYWdlLnNjaGVkdWxlS2V5LCBzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi1nZXQtc2NoZWR1bGVkXCJ9LFxuICAgICAgICBlcnJvcixcbiAgICAgICAgZmFsbGJhY2tNZXNzYWdlOiBcIkZhaWxlZCB0byByZWFkIHNjaGVkdWxlZCBqb2JcIixcbiAgICAgICAganNvblNvY2tldCxcbiAgICAgICAgbG9nTWVzc2FnZTogXCJGYWlsZWQgdG8gcmVhZCBzY2hlZHVsZWQgYmFja2dyb3VuZCBqb2I6XCIsXG4gICAgICAgIHJlc3BvbnNlVHlwZTogXCJnZXQtc2NoZWR1bGVkLWpvYi1lcnJvclwiXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGVzIGEgc3RhYmxlIHNjaGVkdWxlIHdha2UgYW5kIHJlLWFybXMgZGlzcGF0Y2ggYWZ0ZXIgaXRzIHRyYW5zYWN0aW9uIGNvbW1pdHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLmpzb25Tb2NrZXQgLSBKU09OIHNvY2tldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JXYWtlU2NoZWR1bGVkTWVzc2FnZX0gYXJncy5tZXNzYWdlIC0gTWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBoYW5kbGVkLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZVdha2VTY2hlZHVsZWQoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuc3RvcmUud2FrZVNjaGVkdWxlZChtZXNzYWdlLnNjaGVkdWxlS2V5KVxuXG4gICAgICBpZiAocmVzdWx0Lm91dGNvbWUgPT09IFwid29rZW5cIiB8fCByZXN1bHQub3V0Y29tZSA9PT0gXCJhbHJlYWR5X2R1ZVwiKSB7XG4gICAgICAgIHRoaXMuX25vdGlmeUVucXVldWVkKClcbiAgICAgICAgYXdhaXQgdGhpcy5fZHJhaW4oKVxuICAgICAgfVxuXG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwic2NoZWR1bGUtd29rZW5cIiwgLi4ucmVzdWx0fSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5faGFuZGxlQ2xpZW50TXV0YXRpb25FcnJvcih7XG4gICAgICAgIGNvbnRleHQ6IHtzY2hlZHVsZUtleTogbWVzc2FnZS5zY2hlZHVsZUtleSwgc3RhZ2U6IFwiYmFja2dyb3VuZC1qb2Itd2FrZS1zY2hlZHVsZWRcIn0sXG4gICAgICAgIGVycm9yLFxuICAgICAgICBmYWxsYmFja01lc3NhZ2U6IFwiRmFpbGVkIHRvIHdha2Ugc2NoZWR1bGVkIGpvYlwiLFxuICAgICAgICBqc29uU29ja2V0LFxuICAgICAgICBsb2dNZXNzYWdlOiBcIkZhaWxlZCB0byB3YWtlIHNjaGVkdWxlZCBiYWNrZ3JvdW5kIGpvYjpcIixcbiAgICAgICAgcmVzcG9uc2VUeXBlOiBcIndha2Utc2NoZWR1bGVkLWVycm9yXCJcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgc2FmZSB2YWxpZGF0aW9uIGZhaWx1cmVzIGFuZCByZXBvcnRzIHVuZXhwZWN0ZWQgY2xpZW50IG11dGF0aW9ucy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5jb250ZXh0IC0gRnJhbWV3b3JrLWVycm9yIGNvbnRleHQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuZXJyb3IgLSBNdXRhdGlvbiBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5mYWxsYmFja01lc3NhZ2UgLSBDbGllbnQtc2FmZSBmYWxsYmFjayBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5sb2dNZXNzYWdlIC0gRXJyb3IgbG9nIHByZWZpeC5cbiAgICogQHBhcmFtIHtcImVucXVldWUtZXJyb3JcIiB8IFwicmVwbGFjZS1zY2hlZHVsZWQtZXJyb3JcIiB8IFwiY2FuY2VsLXNjaGVkdWxlZC1lcnJvclwiIHwgXCJnZXQtc2NoZWR1bGVkLWpvYi1lcnJvclwiIHwgXCJ3YWtlLXNjaGVkdWxlZC1lcnJvclwifSBhcmdzLnJlc3BvbnNlVHlwZSAtIFJlc3BvbnNlIHR5cGUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2hhbmRsZUNsaWVudE11dGF0aW9uRXJyb3Ioe2NvbnRleHQsIGVycm9yLCBmYWxsYmFja01lc3NhZ2UsIGpzb25Tb2NrZXQsIGxvZ01lc3NhZ2UsIHJlc3BvbnNlVHlwZX0pIHtcbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBWZWxvY2lvdXNFcnJvciAmJiBlcnJvci5zYWZlVG9FeHBvc2UpIHtcbiAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogcmVzcG9uc2VUeXBlLCBlcnJvcjogZXJyb3IubWVzc2FnZX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICBjb25zdCBwYXlsb2FkID0ge2NvbnRleHQsIGVycm9yOiBub3JtYWxpemVkRXJyb3J9XG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW2xvZ01lc3NhZ2UsIG5vcm1hbGl6ZWRFcnJvcl0pXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gICAganNvblNvY2tldC5zZW5kKHt0eXBlOiByZXNwb25zZVR5cGUsIGVycm9yOiBmYWxsYmFja01lc3NhZ2V9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIGpvYiBjb21wbGV0ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkNvbXBsZXRlTWVzc2FnZX0gYXJncy5tZXNzYWdlIC0gTWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBoYW5kbGVkLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZUpvYkNvbXBsZXRlKHtqc29uU29ja2V0LCBtZXNzYWdlfSkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBhY2NlcHRlZCA9IGF3YWl0IHRoaXMuc3RvcmUubWFya0NvbXBsZXRlZCh7XG4gICAgICAgIGpvYklkOiBtZXNzYWdlLmpvYklkLFxuICAgICAgICBoYW5kb2ZmSWQ6IG1lc3NhZ2UuaGFuZG9mZklkLFxuICAgICAgICB3b3JrZXJJZDogbWVzc2FnZS53b3JrZXJJZCxcbiAgICAgICAgaGFuZGVkT2ZmQXRNczogbWVzc2FnZS5oYW5kZWRPZmZBdE1zXG4gICAgICB9KVxuICAgICAgaWYgKGFjY2VwdGVkICYmIG1lc3NhZ2UuaGFuZG9mZklkKSB7XG4gICAgICAgIHRoaXMuX2ZvcmdldEhhbmRvZmYoe2hhbmRvZmZJZDogbWVzc2FnZS5oYW5kb2ZmSWQsIGpvYklkOiBtZXNzYWdlLmpvYklkfSlcbiAgICAgIH1cbiAgICAgIHRoaXMub25Kb2JVcGRhdGVkPy4oe2FjY2VwdGVkLCBqb2JJZDogbWVzc2FnZS5qb2JJZCwgc3RhdHVzOiBcImNvbXBsZXRlZFwifSlcbiAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJqb2ItdXBkYXRlZFwiLCBqb2JJZDogbWVzc2FnZS5qb2JJZH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuX3JlcG9ydEpvYlVwZGF0ZUZhaWx1cmUoe2Vycm9yLCBqb2JJZDogbWVzc2FnZS5qb2JJZCwgc3RhZ2U6IFwiYmFja2dyb3VuZC1qb2ItY29tcGxldGVcIn0pXG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiam9iLXVwZGF0ZS1lcnJvclwiLCBqb2JJZDogbWVzc2FnZS5qb2JJZCwgZXJyb3I6IFwiRmFpbGVkIHRvIHVwZGF0ZSBqb2JcIn0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFN1cmZhY2VzIGFuIHVuZXhwZWN0ZWQgZHVyYWJsZSByZXBvcnQgZmFpbHVyZSB3aXRob3V0IGV4cG9zaW5nIGl0IHRvIHRoZVxuICAgKiByZXBvcnRpbmcgcGVlci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBGYWlsdXJlIGNvbnRleHQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuZXJyb3IgLSBBZGFwdGVyIGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gRHVyYWJsZSBqb2IgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnN0YWdlIC0gTXV0YXRpb24gc3RhZ2UuXG4gICAqL1xuICBfcmVwb3J0Sm9iVXBkYXRlRmFpbHVyZSh7ZXJyb3IsIGpvYklkLCBzdGFnZX0pIHtcbiAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICBjb25zdCBwYXlsb2FkID0ge2NvbnRleHQ6IHtnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkLCBqb2JJZCwgc3RhZ2V9LCBlcnJvcjogbm9ybWFsaXplZEVycm9yfVxuICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIkZhaWxlZCB0byB1cGRhdGUgYmFja2dyb3VuZCBqb2I6XCIsIG5vcm1hbGl6ZWRFcnJvcl0pXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gIH1cblxuICAvKipcbiAgICogUGVyc2lzdHMgYSBub3JtYWwgam9iIHJlc2NoZWR1bGUgb3V0Y29tZSBhbmQgd2FrZXMgc2NoZWR1bGVkIGRpc3BhdGNoLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy5qc29uU29ja2V0IC0gSlNPTiBzb2NrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUmVzY2hlZHVsZU1lc3NhZ2V9IGFyZ3MubWVzc2FnZSAtIE1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gaGFuZGxlZC5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVKb2JSZXNjaGVkdWxlKHtqc29uU29ja2V0LCBtZXNzYWdlfSkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBhY2NlcHRlZCA9IGF3YWl0IHRoaXMuc3RvcmUubWFya1Jlc2NoZWR1bGVkKHtcbiAgICAgICAgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsXG4gICAgICAgIGRlbGF5TXM6IG1lc3NhZ2UuZGVsYXlNcyxcbiAgICAgICAgaGFuZG9mZklkOiBtZXNzYWdlLmhhbmRvZmZJZCxcbiAgICAgICAgd29ya2VySWQ6IG1lc3NhZ2Uud29ya2VySWQsXG4gICAgICAgIGhhbmRlZE9mZkF0TXM6IG1lc3NhZ2UuaGFuZGVkT2ZmQXRNc1xuICAgICAgfSlcbiAgICAgIGlmIChhY2NlcHRlZCAmJiBtZXNzYWdlLmhhbmRvZmZJZCkge1xuICAgICAgICB0aGlzLl9mb3JnZXRIYW5kb2ZmKHtoYW5kb2ZmSWQ6IG1lc3NhZ2UuaGFuZG9mZklkLCBqb2JJZDogbWVzc2FnZS5qb2JJZH0pXG4gICAgICB9XG4gICAgICB0aGlzLm9uSm9iVXBkYXRlZD8uKHthY2NlcHRlZCwgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsIHN0YXR1czogXCJyZXNjaGVkdWxlZFwifSlcbiAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJqb2ItdXBkYXRlZFwiLCBqb2JJZDogbWVzc2FnZS5qb2JJZH0pXG4gICAgICB0aGlzLl9ub3RpZnlFbnF1ZXVlZCgpXG4gICAgICBhd2FpdCB0aGlzLl9kcmFpbigpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKVxuICAgICAgY29uc3QgcGF5bG9hZCA9IHtjb250ZXh0OiB7am9iSWQ6IG1lc3NhZ2Uuam9iSWQsIHN0YWdlOiBcImJhY2tncm91bmQtam9iLXJlc2NoZWR1bGVcIn0sIGVycm9yOiBub3JtYWxpemVkRXJyb3J9XG4gICAgICBjb25zdCBlcnJvckV2ZW50cyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpXG5cbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIkZhaWxlZCB0byB1cGRhdGUgam9iIHJlc2NoZWR1bGU6XCIsIG5vcm1hbGl6ZWRFcnJvcl0pXG4gICAgICBlcnJvckV2ZW50cy5lbWl0KFwiZnJhbWV3b3JrLWVycm9yXCIsIHBheWxvYWQpXG4gICAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImpvYi11cGRhdGUtZXJyb3JcIiwgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsIGVycm9yOiBcIkZhaWxlZCB0byB1cGRhdGUgam9iXCJ9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBqb2IgZmFpbGVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy5qc29uU29ja2V0IC0gSlNPTiBzb2NrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRmFpbGVkTWVzc2FnZX0gYXJncy5tZXNzYWdlIC0gTWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBoYW5kbGVkLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZUpvYkZhaWxlZCh7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgZmFpbGVkSm9iID0gYXdhaXQgdGhpcy5zdG9yZS5tYXJrRmFpbGVkKHtcbiAgICAgICAgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsXG4gICAgICAgIGVycm9yOiBtZXNzYWdlLmVycm9yLFxuICAgICAgICBoYW5kb2ZmSWQ6IG1lc3NhZ2UuaGFuZG9mZklkLFxuICAgICAgICB3b3JrZXJJZDogbWVzc2FnZS53b3JrZXJJZCxcbiAgICAgICAgaGFuZGVkT2ZmQXRNczogbWVzc2FnZS5oYW5kZWRPZmZBdE1zXG4gICAgICB9KVxuXG4gICAgICBpZiAoZmFpbGVkSm9iKSB7XG4gICAgICAgIGlmIChtZXNzYWdlLmhhbmRvZmZJZCkge1xuICAgICAgICAgIHRoaXMuX2ZvcmdldEhhbmRvZmYoe2hhbmRvZmZJZDogbWVzc2FnZS5oYW5kb2ZmSWQsIGpvYklkOiBtZXNzYWdlLmpvYklkfSlcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9lbWl0QmFja2dyb3VuZEpvYkZhaWxlZCh7XG4gICAgICAgICAgZXJyb3I6IG1lc3NhZ2UuZXJyb3IsXG4gICAgICAgICAgaGFuZG9mZklkOiBtZXNzYWdlLmhhbmRvZmZJZCxcbiAgICAgICAgICBoYW5kZWRPZmZBdE1zOiBtZXNzYWdlLmhhbmRlZE9mZkF0TXMsXG4gICAgICAgICAgam9iOiBmYWlsZWRKb2IsXG4gICAgICAgICAgcnVubmVyRmFpbHVyZTogbWVzc2FnZS5ydW5uZXJGYWlsdXJlLFxuICAgICAgICAgIHdvcmtlcklkOiBtZXNzYWdlLndvcmtlcklkXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIHRoaXMub25Kb2JVcGRhdGVkPy4oe2FjY2VwdGVkOiBCb29sZWFuKGZhaWxlZEpvYiksIGpvYklkOiBtZXNzYWdlLmpvYklkLCBzdGF0dXM6IFwiZmFpbGVkXCJ9KVxuICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImpvYi11cGRhdGVkXCIsIGpvYklkOiBtZXNzYWdlLmpvYklkfSlcbiAgICAgIC8vIEEgZmFpbGVkIGpvYiBtYXkgaGF2ZSBiZWVuIHJlLXF1ZXVlZCAod2l0aCBiYWNrb2ZmKSBmb3IgcmV0cnkg4oCUXG4gICAgICAvLyBwb2tlIHRoZSBkaXNwYXRjaGVyIHNvIHRoZSByZXRyeSB0aW1lciBpcyBhcm1lZC5cbiAgICAgIHRoaXMuX25vdGlmeUVucXVldWVkKClcbiAgICAgIGF3YWl0IHRoaXMuX2RyYWluKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiRmFpbGVkIHRvIHVwZGF0ZSBqb2IgZmFpbHVyZTpcIiwgZXJyb3JdKVxuICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImpvYi11cGRhdGUtZXJyb3JcIiwgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsIGVycm9yOiBcIkZhaWxlZCB0byB1cGRhdGUgam9iXCJ9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVtaXQgYmFja2dyb3VuZCBqb2IgZmFpbGVkLlxuICAgKiBAcGFyYW0ge3tlcnJvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGhhbmRvZmZJZD86IHN0cmluZywgaGFuZGVkT2ZmQXRNcz86IG51bWJlciwgam9iOiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3csIHJ1bm5lckZhaWx1cmU/OiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZFJ1bm5lckZhaWx1cmUsIHdvcmtlcklkPzogc3RyaW5nfX0gYXJncyAtIEZhaWx1cmUgZXZlbnQgZGF0YS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfZW1pdEJhY2tncm91bmRKb2JGYWlsZWQoe2Vycm9yLCBoYW5kb2ZmSWQsIGhhbmRlZE9mZkF0TXMsIGpvYiwgcnVubmVyRmFpbHVyZSwgd29ya2VySWR9KSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gdGhpcy5fbm9ybWFsaXplRmFpbHVyZUVycm9yKGVycm9yKVxuICAgIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgICBjb250ZXh0OiB7XG4gICAgICAgIGF0dGVtcHRzOiBqb2IuYXR0ZW1wdHMsXG4gICAgICAgIGhhbmRvZmZJZCxcbiAgICAgICAgaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgam9iQXJnczogam9iLmFyZ3MsXG4gICAgICAgIGpvYklkOiBqb2IuaWQsXG4gICAgICAgIGpvYk5hbWU6IGpvYi5qb2JOYW1lLFxuICAgICAgICBtYXhSZXRyaWVzOiBqb2IubWF4UmV0cmllcyxcbiAgICAgICAgcnVubmVyRmFpbHVyZSxcbiAgICAgICAgc3RhZ2U6IFwiYmFja2dyb3VuZC1qb2ItZmFpbGVkXCIsXG4gICAgICAgIHN0YXR1czogam9iLnN0YXR1cyxcbiAgICAgICAgdGVybWluYWw6IGpvYi5zdGF0dXMgPT09IFwiZmFpbGVkXCIgfHwgam9iLnN0YXR1cyA9PT0gXCJvcnBoYW5lZFwiLFxuICAgICAgICB3aWxsUmV0cnk6IGpvYi5zdGF0dXMgPT09IFwicXVldWVkXCIsXG4gICAgICAgIHdvcmtlcklkXG4gICAgICB9LFxuICAgICAgZXJyb3I6IG5vcm1hbGl6ZWRFcnJvclxuICAgIH1cbiAgICBjb25zdCBlcnJvckV2ZW50cyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpXG5cbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYmFja2dyb3VuZC1qb2ItZmFpbGVkXCIsIHBheWxvYWQpXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4ucGF5bG9hZCwgZXJyb3JUeXBlOiBcImJhY2tncm91bmQtam9iLWZhaWxlZFwifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBFbWl0cyBgYmFja2dyb3VuZC1qb2Itb3JwaGFuZWRgIChtaXJyb3JlZCB0byBgYWxsLWVycm9yYCkgZm9yIGEgam9iIHRoZSB0aW1lLWJhc2VkIG9ycGhhbiBzd2VlcFxuICAgKiByZWNsYWltZWQgYWZ0ZXIgaXRzIHdvcmtlciBkaWVkIG1pZC1ydW4uIFVubGlrZSBgYmFja2dyb3VuZC1qb2ItZmFpbGVkYCwgd2hpY2ggZmlyZXMgb24gYVxuICAgKiB3b3JrZXIncyBmYWlsdXJlIHJlcG9ydCwgdGhpcyBmaXJlcyBmcm9tIHRoZSBtYWluIHByb2Nlc3MncyBzd2VlcCwgc28gYXBwbGljYXRpb25zIGNhbiByZWFjdCB0b1xuICAgKiBhIGRlYWQgd29ya2VyJ3Mgc3BlY2lmaWMgam9iIOKAlCByZWNvdmVyIHRoZSB3b3JrIGl0IGxlZnQgYmVoaW5kIOKAlCB3aXRob3V0IHBvbGxpbmcuIGB3aWxsUmV0cnlgXG4gICAqIHJlZmxlY3RzIHdoZXRoZXIgdGhlIHJlY2xhaW0gcmV0dXJuZWQgdGhlIGpvYiB0byB0aGUgcXVldWUgZm9yIGFub3RoZXIgYXR0ZW1wdC5cbiAgICogQHBhcmFtIHt7am9iOiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9fSBhcmdzIC0gVGhlIG9ycGhhbmVkIGpvYi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfZW1pdEJhY2tncm91bmRKb2JPcnBoYW5lZCh7am9ifSkge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IHRoaXMuX25vcm1hbGl6ZUZhaWx1cmVFcnJvcihqb2IubGFzdEVycm9yID8/IFwiSm9iIG9ycGhhbmVkIGFmdGVyIHRpbWVvdXRcIilcbiAgICBjb25zdCBwYXlsb2FkID0ge1xuICAgICAgY29udGV4dDoge1xuICAgICAgICBhdHRlbXB0czogam9iLmF0dGVtcHRzLFxuICAgICAgICBqb2JBcmdzOiBqb2IuYXJncyxcbiAgICAgICAgam9iSWQ6IGpvYi5pZCxcbiAgICAgICAgam9iTmFtZTogam9iLmpvYk5hbWUsXG4gICAgICAgIG1heFJldHJpZXM6IGpvYi5tYXhSZXRyaWVzLFxuICAgICAgICBzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi1vcnBoYW5lZFwiLFxuICAgICAgICBzdGF0dXM6IGpvYi5zdGF0dXMsXG4gICAgICAgIHRlcm1pbmFsOiBqb2Iuc3RhdHVzID09PSBcImZhaWxlZFwiIHx8IGpvYi5zdGF0dXMgPT09IFwib3JwaGFuZWRcIixcbiAgICAgICAgd2lsbFJldHJ5OiBqb2Iuc3RhdHVzID09PSBcInF1ZXVlZFwiXG4gICAgICB9LFxuICAgICAgZXJyb3I6IG5vcm1hbGl6ZWRFcnJvclxuICAgIH1cbiAgICBjb25zdCBlcnJvckV2ZW50cyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpXG5cbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYmFja2dyb3VuZC1qb2Itb3JwaGFuZWRcIiwgcGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiYmFja2dyb3VuZC1qb2Itb3JwaGFuZWRcIn0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgZmFpbHVyZSBlcnJvci5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBSZXBvcnRlZCBmYWlsdXJlIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7RXJyb3J9IE5vcm1hbGl6ZWQgZXJyb3IuXG4gICAqL1xuICBfbm9ybWFsaXplRmFpbHVyZUVycm9yKGVycm9yKSB7XG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHJldHVybiBlcnJvclxuXG4gICAgcmV0dXJuIHRoaXMuX2Vycm9yRnJvbVVua25vd25GYWlsdXJlKGVycm9yKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXJyb3IgZnJvbSB1bmtub3duIGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gUmVwb3J0ZWQgZmFpbHVyZSB2YWx1ZS5cbiAgICogQHJldHVybnMge0Vycm9yfSBOb3JtYWxpemVkIGVycm9yLlxuICAgKi9cbiAgX2Vycm9yRnJvbVVua25vd25GYWlsdXJlKGVycm9yKSB7XG4gICAgY29uc3QgbWVzc2FnZSA9IHRoaXMuX21lc3NhZ2VGcm9tVW5rbm93bkZhaWx1cmUoZXJyb3IpXG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gbmV3IEVycm9yKG1lc3NhZ2UpXG5cbiAgICB0aGlzLl9jb3B5U3RyaW5nRmFpbHVyZVN0YWNrKHtlcnJvciwgbm9ybWFsaXplZEVycm9yfSlcblxuICAgIHJldHVybiBub3JtYWxpemVkRXJyb3JcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1lc3NhZ2UgZnJvbSB1bmtub3duIGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gUmVwb3J0ZWQgZmFpbHVyZSB2YWx1ZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gRXJyb3IgbWVzc2FnZS5cbiAgICovXG4gIF9tZXNzYWdlRnJvbVVua25vd25GYWlsdXJlKGVycm9yKSB7XG4gICAgaWYgKHRoaXMuX2hhc1N0cmluZ0ZhaWx1cmUoZXJyb3IpKSByZXR1cm4gZXJyb3IudHJpbSgpLnNwbGl0KFwiXFxuXCIpWzBdXG5cbiAgICByZXR1cm4gU3RyaW5nKGVycm9yIHx8IFwiQmFja2dyb3VuZCBqb2IgZmFpbGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYXMgc3RyaW5nIGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gUmVwb3J0ZWQgZmFpbHVyZSB2YWx1ZS5cbiAgICogQHJldHVybnMge2Vycm9yIGlzIHN0cmluZ30gV2hldGhlciB0aGUgdmFsdWUgaXMgYSBub24tZW1wdHkgc3RyaW5nLlxuICAgKi9cbiAgX2hhc1N0cmluZ0ZhaWx1cmUoZXJyb3IpIHtcbiAgICByZXR1cm4gdHlwZW9mIGVycm9yID09PSBcInN0cmluZ1wiICYmIGVycm9yLnRyaW0oKS5sZW5ndGggPiAwXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb3B5IHN0cmluZyBmYWlsdXJlIHN0YWNrLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuZXJyb3IgLSBSZXBvcnRlZCBmYWlsdXJlIHZhbHVlLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBhcmdzLm5vcm1hbGl6ZWRFcnJvciAtIE5vcm1hbGl6ZWQgZXJyb3IuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2NvcHlTdHJpbmdGYWlsdXJlU3RhY2soe2Vycm9yLCBub3JtYWxpemVkRXJyb3J9KSB7XG4gICAgaWYgKHRoaXMuX2hhc1N0cmluZ0ZhaWx1cmUoZXJyb3IpKSBub3JtYWxpemVkRXJyb3Iuc3RhY2sgPSBlcnJvclxuICB9XG5cbiAgLyoqXG4gICAqIERyYWlucyBhbGwgZGlzcGF0Y2hhYmxlIGpvYnMgdG8gcmVhZHkgd29ya2VycywgdGhlbiBhcm1zIHRoZVxuICAgKiBzY2hlZHVsZWQtam9iIHRpbWVyIGZvciB0aGUgbmV4dCBmdXR1cmUgYHNjaGVkdWxlZF9hdF9tc2AuIENvYWxlc2Nlc1xuICAgKiBjb25jdXJyZW50IHRyaWdnZXJzOiBhIHdha2UtdXAgdGhhdCBsYW5kcyB3aGlsZSBhIGRyYWluIGlzIGluXG4gICAqIGZsaWdodCBqdXN0IHNldHMgYSByZS1kcmFpbiBmbGFnIGFuZCBsZXRzIHRoZSBpbi1mbGlnaHQgZHJhaW5cbiAgICogcmUtbG9vcCBhZnRlciBpdCBmaW5pc2hlcywgc28gbm8gc2lnbmFsIGlzIGRyb3BwZWQgYnV0IG5vIHR3b1xuICAgKiBkcmFpbnMgcnVuIGluIHBhcmFsbGVsLlxuICAgKlxuICAgKiBSZXNpbGllbmNlOiBpbiBiZWFjb24gbW9kZSB0aGlzIGlzIHRoZSBzb2xlIHdha2UtdXAgcGF0aCBmb3JcbiAgICogYWxyZWFkeS1xdWV1ZWQgd29yaywgc28gYSB0cmFuc2llbnQgREIgZXJyb3IgZHVyaW5nIHRoZSBkcmFpbiAoZS5nLlxuICAgKiBgbmV4dEF2YWlsYWJsZUpvYigpYCByZWplY3RpbmcpIG11c3Qgbm90IHN0cmFuZCB0aGUgcXVldWUgdW50aWwgdGhlXG4gICAqIG5leHQgZXh0ZXJuYWwgc2lnbmFsLiBPbiBhbnkgZXJyb3Igd2UgbG9nIGl0IGFuZCBhcm0gYSBvbmUtc2hvdFxuICAgKiByZXRyeSB2aWEgYF9zY2hlZHVsZUVycm9yUmV0cnlgIHVzaW5nIGBwb2xsSW50ZXJ2YWxNc2AgYXMgdGhlXG4gICAqIGNhZGVuY2U7IG9uIHN1Y2Nlc3MgdGhlIHJldHJ5IHRpbWVyIGlzIGNsZWFyZWQuIFBvbGxpbmctbW9kZSBydW5zXG4gICAqIGBfZHJhaW5gIGZyb20gaXRzIG93biBpbnRlcnZhbCwgc28gdGhlIHJldHJ5IHRpbWVyIGlzIGEgbm8tb3AgdGhlcmUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2RyYWluKCkge1xuICAgIGlmICh0aGlzLl9zdG9wcGVkIHx8IHRoaXMubGlmZWN5Y2xlU3RhdGUgIT09IFwiYWN0aXZlXCIgfHwgIXRoaXMuX2FjdGl2ZU93bmVyc2hpcFJlYWR5KSByZXR1cm5cblxuICAgIGlmICh0aGlzLl9kcmFpblByb21pc2UpIHtcbiAgICAgIHRoaXMuX3JlZHJhaW5RdWV1ZWQgPSB0cnVlXG4gICAgICBhd2FpdCB0aGlzLl9kcmFpblByb21pc2VcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IGRyYWluUHJvbWlzZSA9IHRoaXMuX2RyYWluVG9Db21wbGV0aW9uKClcblxuICAgIHRoaXMuX2RyYWluUHJvbWlzZSA9IGRyYWluUHJvbWlzZVxuICAgIGF3YWl0IGRyYWluUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb25lIHNlcmlhbGl6ZWQgZHJhaW4gbGlmZWN5Y2xlLCBpbmNsdWRpbmcgdGltZXIgcmUtYXJtaW5nLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBldmVyeSBjb2FsZXNjZWQgcmVxdWVzdCBpcyBoYW5kbGVkLlxuICAgKi9cbiAgYXN5bmMgX2RyYWluVG9Db21wbGV0aW9uKCkge1xuICAgIHRoaXMuX2RyYWluaW5nID0gdHJ1ZVxuXG4gICAgdHJ5IHtcbiAgICAgIGxldCBlcnJvcmVkXG5cbiAgICAgIGRvIHtcbiAgICAgICAgZXJyb3JlZCA9IGF3YWl0IHRoaXMuX2RyYWluVW50aWxJZGxlKClcbiAgICAgICAgYXdhaXQgdGhpcy5fZmluaXNoRHJhaW4oe2Vycm9yZWR9KVxuICAgICAgfSB3aGlsZSAoIWVycm9yZWQgJiYgdGhpcy5fcmVkcmFpblF1ZXVlZCAmJiAhdGhpcy5fc3RvcHBlZCAmJiB0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcImFjdGl2ZVwiKVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl9kcmFpbmluZyA9IGZhbHNlXG4gICAgICB0aGlzLl9kcmFpblByb21pc2UgPSB1bmRlZmluZWRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5pc2ggZHJhaW4uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLmVycm9yZWQgLSBXaGV0aGVyIHRoZSBkcmFpbiBoaXQgYW4gZXJyb3IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGZvbGxvdy11cCB0aW1lcnMgYXJlIGhhbmRsZWQuXG4gICAqL1xuICBhc3luYyBfZmluaXNoRHJhaW4oe2Vycm9yZWR9KSB7XG4gICAgaWYgKHRoaXMuX3N0b3BwZWQgfHwgdGhpcy5saWZlY3ljbGVTdGF0ZSAhPT0gXCJhY3RpdmVcIikgcmV0dXJuXG4gICAgaWYgKGVycm9yZWQpIHJldHVybiB0aGlzLl9zY2hlZHVsZUVycm9yUmV0cnkoKVxuXG4gICAgYXdhaXQgdGhpcy5fYXJtU2NoZWR1bGVkVGltZXJPclJldHJ5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFybSBzY2hlZHVsZWQgdGltZXIgb3IgcmV0cnkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHNjaGVkdWxlZCB0aW1lciBoYW5kbGluZy5cbiAgICovXG4gIGFzeW5jIF9hcm1TY2hlZHVsZWRUaW1lck9yUmV0cnkoKSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX2FybVNjaGVkdWxlZFRpbWVyKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiQmFja2dyb3VuZCBqb2JzIHNjaGVkdWxlZC10aW1lciBhcm1pbmcgZmFpbGVkOlwiLCBlcnJvcl0pXG4gICAgICB0aGlzLl9zY2hlZHVsZUVycm9yUmV0cnkoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5fY2xlYXJFcnJvclJldHJ5VGltZXIoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xlYXIgZXJyb3IgcmV0cnkgdGltZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAqL1xuICBfY2xlYXJFcnJvclJldHJ5VGltZXIoKSB7XG4gICAgaWYgKHRoaXMucGVuZGluZ0hhbmRvZmZSZWNvdmVyaWVzLnNpemUgPiAwKSByZXR1cm5cbiAgICBpZiAodGhpcy5fc3RhcnR1cEhhbmRvZmZHcmFjZUVsYXBzZWQgJiYgdGhpcy5zdGFydHVwSGFuZG9mZlNuYXBzaG90Lmxlbmd0aCA+IDApIHJldHVyblxuXG4gICAgZm9yIChjb25zdCB3b3JrZXIgb2YgdGhpcy53b3JrZXJIYW5kb2Zmcy5rZXlzKCkpIHtcbiAgICAgIGlmICghdGhpcy53b3JrZXJzLmhhcyh3b3JrZXIpKSByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAodGhpcy5fZXJyb3JSZXRyeVRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5fZXJyb3JSZXRyeVRpbWVyKVxuICAgICAgdGhpcy5fZXJyb3JSZXRyeVRpbWVyID0gdW5kZWZpbmVkXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZHJhaW4gdW50aWwgaWRsZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgZHJhaW4gaGl0IGFuIGVycm9yLlxuICAgKi9cbiAgYXN5bmMgX2RyYWluVW50aWxJZGxlKCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9ydW5EcmFpbkxvb3AoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIGRyYWluIGxvb3AuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGRyYWluIGhpdCBhbiBlcnJvci5cbiAgICovXG4gIGFzeW5jIF9ydW5EcmFpbkxvb3AoKSB7XG4gICAgZG8ge1xuICAgICAgdGhpcy5fcmVkcmFpblF1ZXVlZCA9IGZhbHNlXG4gICAgICBjb25zdCBlcnJvcmVkID0gYXdhaXQgdGhpcy5fZHJhaW5PbmNlV2l0aEVycm9yUmVwb3J0KClcblxuICAgICAgaWYgKGVycm9yZWQpIHJldHVybiB0cnVlXG4gICAgfSB3aGlsZSAodGhpcy5fcmVkcmFpblF1ZXVlZCAmJiAhdGhpcy5fc3RvcHBlZClcblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZHJhaW4gb25jZSB3aXRoIGVycm9yIHJlcG9ydC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBvbmUgZHJhaW4gcGFzcyBmYWlsZWQuXG4gICAqL1xuICBhc3luYyBfZHJhaW5PbmNlV2l0aEVycm9yUmVwb3J0KCkge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl9kcmFpbk9uY2UoKVxuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIkJhY2tncm91bmQgam9icyBkcmFpbiBmYWlsZWQ6XCIsIGVycm9yXSlcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFybXMgYSBvbmUtc2hvdCBgc2V0VGltZW91dGAgdG8gcmV0cnkgYF9kcmFpbmAgYWZ0ZXIgYSB0cmFuc2llbnRcbiAgICogZmFpbHVyZS4gSWRlbXBvdGVudCDigJQgcmVwZWF0ZWQgY2FsbHMgd2hpbGUgYSByZXRyeSBpcyBhbHJlYWR5XG4gICAqIHBlbmRpbmcgYXJlIG5vLW9wcy4gUG9sbGluZyBtb2RlIGFscmVhZHkgcmV0cmllcyB2aWEgaXRzIG93blxuICAgKiBpbnRlcnZhbCwgc28gdGhpcyBpcyBhIG5vLW9wIGluIHRoYXQgbW9kZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2NoZWR1bGVFcnJvclJldHJ5KCkge1xuICAgIGlmICh0aGlzLl9zdG9wcGVkKSByZXR1cm5cbiAgICBpZiAodGhpcy5fZXJyb3JSZXRyeVRpbWVyKSByZXR1cm5cbiAgICBpZiAodGhpcy5kaXNwYXRjaFN0cmF0ZWd5ID09PSBcInBvbGxpbmdcIiAmJiB0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcImFjdGl2ZVwiKSByZXR1cm5cblxuICAgIHRoaXMuX2Vycm9yUmV0cnlUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdGhpcy5fZXJyb3JSZXRyeVRpbWVyID0gdW5kZWZpbmVkXG4gICAgICB2b2lkIHRoaXMuX3JldHJ5QWZ0ZXJFcnJvcigpXG4gICAgfSwgdGhpcy5wb2xsSW50ZXJ2YWxNcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXRyaWVzIGZhaWxlZCBwcmUtZGlzcGF0Y2ggYW5kIGRpc2Nvbm5lY3RlZC1zb2NrZXQgcmVsZWFzZXMgYmVmb3JlXG4gICAqIGRyYWluaW5nIHF1ZXVlZCB3b3JrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciByZXRyeSB3b3JrLlxuICAgKi9cbiAgYXN5bmMgX3JldHJ5QWZ0ZXJFcnJvcigpIHtcbiAgICBpZiAodGhpcy5fc3RvcHBlZCkgcmV0dXJuXG5cbiAgICBpZiAodGhpcy5fc3RhcnR1cEhhbmRvZmZHcmFjZUVsYXBzZWQgJiYgdGhpcy5zdGFydHVwSGFuZG9mZlNuYXBzaG90Lmxlbmd0aCA+IDApIHtcbiAgICAgIGF3YWl0IHRoaXMuX3N0YXJ0U3RhcnR1cEhhbmRvZmZSZWNsYWltKClcbiAgICAgIGlmICh0aGlzLnN0YXJ0dXBIYW5kb2ZmU25hcHNob3QubGVuZ3RoID4gMCkgcmV0dXJuXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX3JldHJ5UGVuZGluZ0hhbmRvZmZSZWNvdmVyaWVzKClcbiAgICB9IGNhdGNoIHtcbiAgICAgIHRoaXMuX3NjaGVkdWxlRXJyb3JSZXRyeSgpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgZm9yIChjb25zdCB3b3JrZXIgb2YgdGhpcy53b3JrZXJIYW5kb2Zmcy5rZXlzKCkpIHtcbiAgICAgICAgaWYgKCF0aGlzLndvcmtlcnMuaGFzKHdvcmtlcikpIGF3YWl0IHRoaXMuX3JlbGVhc2VXb3JrZXJIYW5kb2Zmcyh3b3JrZXIpXG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuX3JlcG9ydEhhbmRvZmZSZWxlYXNlRXJyb3IoZXJyb3IpXG4gICAgICB0aGlzLl9zY2hlZHVsZUVycm9yUmV0cnkoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwiYWN0aXZlXCIpIGF3YWl0IHRoaXMuX2RyYWluKClcbiAgICB0aGlzLl9tYXliZVN0b3BSZXRpcmVkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBJbm5lciBkcmFpbiBsb29wOiBwdWxscyBlbGlnaWJsZSBxdWV1ZWQgam9icyBhbmQgaGFuZHMgdGhlbSBvZmYgdG9cbiAgICogcmVhZHkgd29ya2VycyB1bnRpbCBvbmUgb2YgdGhlbSBydW5zIG91dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfZHJhaW5PbmNlKCkge1xuICAgIHdoaWxlICh0aGlzLnJlYWR5V29ya2Vycy5zaXplID4gMCAmJiAhdGhpcy5fc3RvcHBlZCAmJiB0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcImFjdGl2ZVwiICYmIHRoaXMuX2FjdGl2ZU93bmVyc2hpcFJlYWR5KSB7XG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLm5leHRBdmFpbGFibGVKb2JGb3JSZWFkeVdvcmtlcnMoKVxuICAgICAgaWYgKCFqb2IpIHJldHVyblxuXG4gICAgICBjb25zdCB3b3JrZXIgPSB0aGlzLnJlYWR5V29ya2VyRm9ySm9iKGpvYilcbiAgICAgIGlmICghd29ya2VyKSByZXR1cm5cblxuICAgICAgY29uc3QgYWRtaXNzaW9uID0gdGhpcy5fY29uc3VtZVdvcmtlckFkbWlzc2lvbih7am9iLCB3b3JrZXJ9KVxuICAgICAgY29uc3QgcmVxdWVzdGVkSGFuZG9mZklkID0gcmFuZG9tVVVJRCgpXG4gICAgICBsZXQgaGFuZG9mZlxuXG4gICAgICB0cnkge1xuICAgICAgICBoYW5kb2ZmID0gYXdhaXQgdGhpcy5zdG9yZS5tYXJrSGFuZGVkT2ZmKHtoYW5kb2ZmSWQ6IHJlcXVlc3RlZEhhbmRvZmZJZCwgam9iSWQ6IGpvYi5pZCwgd29ya2VySWQ6IHdvcmtlci53b3JrZXJJZH0pXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aGlzLl9yZW1lbWJlckhhbmRvZmZSZWNvdmVyeSh7aGFuZG9mZklkOiByZXF1ZXN0ZWRIYW5kb2ZmSWQsIGpvYklkOiBqb2IuaWR9KVxuICAgICAgICB0aGlzLl9yZXN0b3JlV29ya2VyQWRtaXNzaW9uKHsuLi5hZG1pc3Npb24sIHdvcmtlcn0pXG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLl9yZWNvdmVySGFuZG9mZih7aGFuZG9mZklkOiByZXF1ZXN0ZWRIYW5kb2ZmSWQsIGpvYklkOiBqb2IuaWR9KVxuICAgICAgICB9IGNhdGNoIChyZWNvdmVyeUVycm9yKSB7XG4gICAgICAgICAgdGhpcy5fcmVwb3J0SGFuZG9mZlJlY292ZXJ5RXJyb3Ioe2Vycm9yOiByZWNvdmVyeUVycm9yLCBoYW5kb2ZmSWQ6IHJlcXVlc3RlZEhhbmRvZmZJZCwgam9iSWQ6IGpvYi5pZH0pXG4gICAgICAgIH1cblxuICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgfVxuXG4gICAgICBpZiAoIWhhbmRvZmYpIHtcbiAgICAgICAgdGhpcy5fcmVzdG9yZVdvcmtlckFkbWlzc2lvbih7Li4uYWRtaXNzaW9uLCB3b3JrZXJ9KVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLmFmdGVySGFuZG9mZkNsYWltPy4oe2hhbmRvZmYsIGpvYn0pXG5cbiAgICAgIGNvbnN0IGhhbmRvZmZzID0gdGhpcy53b3JrZXJIYW5kb2Zmcy5nZXQod29ya2VyKVxuXG4gICAgICBpZiAoIWhhbmRvZmZzIHx8ICF0aGlzLndvcmtlcnMuaGFzKHdvcmtlcikgfHwgd29ya2VyLmlzRHJhaW5pbmcgfHwgdGhpcy5saWZlY3ljbGVTdGF0ZSAhPT0gXCJhY3RpdmVcIiB8fCAhdGhpcy5fYWN0aXZlT3duZXJzaGlwUmVhZHkpIHtcbiAgICAgICAgdGhpcy5fcmVtZW1iZXJIYW5kb2ZmUmVjb3Zlcnkoe2hhbmRvZmZJZDogaGFuZG9mZi5oYW5kb2ZmSWQsIGpvYklkOiBqb2IuaWR9KVxuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IHRoaXMuX3JlY292ZXJIYW5kb2ZmKHtoYW5kb2ZmSWQ6IGhhbmRvZmYuaGFuZG9mZklkLCBqb2JJZDogam9iLmlkfSlcbiAgICAgICAgfSBjYXRjaCAocmVjb3ZlcnlFcnJvcikge1xuICAgICAgICAgIHRoaXMuX3JlcG9ydEhhbmRvZmZSZWNvdmVyeUVycm9yKHtlcnJvcjogcmVjb3ZlcnlFcnJvciwgaGFuZG9mZklkOiBoYW5kb2ZmLmhhbmRvZmZJZCwgam9iSWQ6IGpvYi5pZH0pXG4gICAgICAgICAgdGhyb3cgcmVjb3ZlcnlFcnJvclxuICAgICAgICB9XG4gICAgICAgIHRoaXMuX25vdGlmeUVucXVldWVkKClcbiAgICAgICAgdGhpcy5fcmVkcmFpblF1ZXVlZCA9IHRydWVcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgdGhpcy5fZmluYWxpemVXb3JrZXJBZG1pc3Npb24oey4uLmFkbWlzc2lvbiwgam9iLCB3b3JrZXJ9KVxuICAgICAgaGFuZG9mZnMuc2V0KGpvYi5pZCwgaGFuZG9mZi5oYW5kb2ZmSWQpXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGRpc3BhdGNoZWRKb2IgPSBoYW5kb2ZmLmpvYiB8fCBqb2JcblxuICAgICAgICB3b3JrZXIuc2VuZCh7XG4gICAgICAgICAgdHlwZTogXCJqb2JcIixcbiAgICAgICAgICBwYXlsb2FkOiB7XG4gICAgICAgICAgICBpZDogZGlzcGF0Y2hlZEpvYi5pZCxcbiAgICAgICAgICAgIGpvYk5hbWU6IGRpc3BhdGNoZWRKb2Iuam9iTmFtZSxcbiAgICAgICAgICAgIGFyZ3M6IGRpc3BhdGNoZWRKb2IuYXJncyxcbiAgICAgICAgICAgIGhhbmRvZmZJZDogaGFuZG9mZi5oYW5kb2ZmSWQsXG4gICAgICAgICAgICB3b3JrZXJJZDogd29ya2VyLndvcmtlcklkLFxuICAgICAgICAgICAgaGFuZGVkT2ZmQXRNczogaGFuZG9mZi5oYW5kZWRPZmZBdE1zLFxuICAgICAgICAgICAgb3B0aW9uczoge1xuICAgICAgICAgICAgICBjb25jdXJyZW5jeUtleTogZGlzcGF0Y2hlZEpvYi5jb25jdXJyZW5jeUtleSB8fCB1bmRlZmluZWQsXG4gICAgICAgICAgICAgIGV4ZWN1dGlvbk1vZGU6IGRpc3BhdGNoZWRKb2IuZXhlY3V0aW9uTW9kZSxcbiAgICAgICAgICAgICAgbWF4Q29uY3VycmVuY3k6IGRpc3BhdGNoZWRKb2IubWF4Q29uY3VycmVuY3kgPz8gdW5kZWZpbmVkLFxuICAgICAgICAgICAgICBtYXhSZXRyaWVzOiBkaXNwYXRjaGVkSm9iLm1heFJldHJpZXMgPz8gdW5kZWZpbmVkLFxuICAgICAgICAgICAgICBxdWV1ZTogZGlzcGF0Y2hlZEpvYi5xdWV1ZSxcbiAgICAgICAgICAgICAgc2NoZWR1bGVkQXRNczogZGlzcGF0Y2hlZEpvYi5zY2hlZHVsZWRBdE1zID8/IHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgLi4uKGRpc3BhdGNoZWRKb2IudGltZW91dE1zID09PSBudWxsID8ge30gOiB7dGltZW91dE1zOiBkaXNwYXRjaGVkSm9iLnRpbWVvdXRNc30pXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9KVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIud2FybigoKSA9PiBbXCJGYWlsZWQgdG8gc2VuZCBqb2IgdG8gd29ya2VyLCByZS1xdWV1ZWluZzpcIiwgZXJyb3JdKVxuICAgICAgICB0cnkge1xuICAgICAgICAgIHdvcmtlci5jbG9zZSgpXG4gICAgICAgIH0gY2F0Y2ggKGNsb3NlRXJyb3IpIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKCgpID0+IFtcIkZhaWxlZCB0byBjbG9zZSB3b3JrZXIgYWZ0ZXIgam9iIHNlbmQgZmFpbHVyZTpcIiwgY2xvc2VFcnJvcl0pXG4gICAgICAgIH1cbiAgICAgICAgYXdhaXQgdGhpcy5faGFuZGxlV29ya2VyU29ja2V0Q2xvc2VkKHdvcmtlciwge3F1ZXVlUmVkcmFpbjogdHJ1ZX0pXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENvbnN1bWVzIG9uZSBhZHZlcnRpc2VkIHdvcmtlciBhZG1pc3Npb24gd2hpbGUgcGVyc2lzdGVuY2UgaXMgaW4gZmxpZ2h0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFkbWlzc2lvbiBkZXRhaWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gYXJncy5qb2IgLSBTZWxlY3RlZCBqb2IuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy53b3JrZXIgLSBTZWxlY3RlZCB3b3JrZXIgc29ja2V0LlxuICAgKiBAcmV0dXJucyB7e3Bvb2xlZENyZWRpdENvbnN1bWVkOiBib29sZWFuLCByZWFkaW5lc3NWZXJzaW9uOiBudW1iZXJ9fSAtIFJldmVyc2libGUgYWRtaXNzaW9uIGRlYml0LlxuICAgKi9cbiAgX2NvbnN1bWVXb3JrZXJBZG1pc3Npb24oe2pvYiwgd29ya2VyfSkge1xuICAgIGxldCBwb29sZWRDcmVkaXRDb25zdW1lZCA9IGZhbHNlXG5cbiAgICB0aGlzLnJlYWR5V29ya2Vycy5kZWxldGUod29ya2VyKVxuXG4gICAgaWYgKGpvYi5leGVjdXRpb25Nb2RlID09PSBcInBvb2xlZFwiICYmIHdvcmtlci51c2VzUG9vbGVkQ2FwYWNpdHlDcmVkaXRzICYmIHdvcmtlci5hdmFpbGFibGVQb29sZWRTbG90cyA+IDApIHtcbiAgICAgIHBvb2xlZENyZWRpdENvbnN1bWVkID0gdHJ1ZVxuICAgICAgd29ya2VyLmF2YWlsYWJsZVBvb2xlZFNsb3RzIC09IDFcbiAgICAgIGlmICh3b3JrZXIuYXZhaWxhYmxlUG9vbGVkU2xvdHMgPiAwKSB0aGlzLnJlYWR5V29ya2Vycy5hZGQod29ya2VyKVxuICAgIH1cblxuICAgIHJldHVybiB7cG9vbGVkQ3JlZGl0Q29uc3VtZWQsIHJlYWRpbmVzc1ZlcnNpb246IHdvcmtlci5yZWFkaW5lc3NWZXJzaW9ufVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc3RvcmVzIGFuIGFkbWlzc2lvbiB0aGF0IG5ldmVyIHJlYWNoZWQgYSB3b3JrZXIuIEEgbmV3ZXIgcmVhZGluZXNzXG4gICAqIGFkdmVydGlzZW1lbnQgaXMgYWxyZWFkeSBhdXRob3JpdGF0aXZlLCBzbyBpdHMgcG9vbGVkIGNvdW50IGlzIG5vdCBjaGFuZ2VkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFkbWlzc2lvbiBkZXRhaWxzLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MucG9vbGVkQ3JlZGl0Q29uc3VtZWQgLSBXaGV0aGVyIGEgcG9vbGVkIGNyZWRpdCB3YXMgZGViaXRlZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MucmVhZGluZXNzVmVyc2lvbiAtIFJlYWRpbmVzcyBnZW5lcmF0aW9uIGF0IGRlYml0IHRpbWUuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy53b3JrZXIgLSBTZWxlY3RlZCB3b3JrZXIgc29ja2V0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXN0b3JlV29ya2VyQWRtaXNzaW9uKHtwb29sZWRDcmVkaXRDb25zdW1lZCwgcmVhZGluZXNzVmVyc2lvbiwgd29ya2VyfSkge1xuICAgIGlmICh0aGlzLl9zdG9wcGVkIHx8IHRoaXMubGlmZWN5Y2xlU3RhdGUgIT09IFwiYWN0aXZlXCIgfHwgIXRoaXMuX2FjdGl2ZU93bmVyc2hpcFJlYWR5IHx8ICF0aGlzLndvcmtlcnMuaGFzKHdvcmtlcikgfHwgd29ya2VyLmlzRHJhaW5pbmcpIHJldHVyblxuXG4gICAgaWYgKHBvb2xlZENyZWRpdENvbnN1bWVkICYmIHdvcmtlci5yZWFkaW5lc3NWZXJzaW9uID09PSByZWFkaW5lc3NWZXJzaW9uKSB7XG4gICAgICB3b3JrZXIuYXZhaWxhYmxlUG9vbGVkU2xvdHMgKz0gMVxuICAgIH1cblxuICAgIGlmICh3b3JrZXIuc3VwcG9ydHNIYW5kb2ZmSWRSZXBvcnRpbmcpIHRoaXMucmVhZHlXb3JrZXJzLmFkZCh3b3JrZXIpXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBhIHN1Y2Nlc3NmdWwgcG9vbGVkIGFkbWlzc2lvbiB0byBhIHJlYWRpbmVzcyBhZHZlcnRpc2VtZW50IHRoYXRcbiAgICogYXJyaXZlZCB3aGlsZSBwZXJzaXN0ZW5jZSB3YXMgaW4gZmxpZ2h0IGFuZCByZXBsYWNlZCB0aGUgZWFybGllciBkZWJpdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBZG1pc3Npb24gZGV0YWlscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGFyZ3Muam9iIC0gU2VsZWN0ZWQgam9iLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MucG9vbGVkQ3JlZGl0Q29uc3VtZWQgLSBXaGV0aGVyIGEgcG9vbGVkIGNyZWRpdCB3YXMgZGViaXRlZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MucmVhZGluZXNzVmVyc2lvbiAtIFJlYWRpbmVzcyBnZW5lcmF0aW9uIGF0IGRlYml0IHRpbWUuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy53b3JrZXIgLSBTZWxlY3RlZCB3b3JrZXIgc29ja2V0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9maW5hbGl6ZVdvcmtlckFkbWlzc2lvbih7am9iLCBwb29sZWRDcmVkaXRDb25zdW1lZCwgcmVhZGluZXNzVmVyc2lvbiwgd29ya2VyfSkge1xuICAgIGlmICghcG9vbGVkQ3JlZGl0Q29uc3VtZWQgfHwgam9iLmV4ZWN1dGlvbk1vZGUgIT09IFwicG9vbGVkXCIpIHJldHVyblxuICAgIGlmICh3b3JrZXIucmVhZGluZXNzVmVyc2lvbiA9PT0gcmVhZGluZXNzVmVyc2lvbiB8fCAhd29ya2VyLnVzZXNQb29sZWRDYXBhY2l0eUNyZWRpdHMpIHJldHVyblxuICAgIGlmICh3b3JrZXIuYXZhaWxhYmxlUG9vbGVkU2xvdHMgPD0gMCkgcmV0dXJuXG5cbiAgICB3b3JrZXIuYXZhaWxhYmxlUG9vbGVkU2xvdHMgLT0gMVxuICAgIGlmICh3b3JrZXIuYXZhaWxhYmxlUG9vbGVkU2xvdHMgPT09IDApIHRoaXMucmVhZHlXb3JrZXJzLmRlbGV0ZSh3b3JrZXIpXG4gIH1cblxuICAvKipcbiAgICogUmV0YWlucyBhbiBleGFjdCBsZWFzZSBmb3IgaWRlbXBvdGVudCBwcmUtZGlzcGF0Y2ggcmVjb3ZlcnkuXG4gICAqIEBwYXJhbSB7e2hhbmRvZmZJZDogc3RyaW5nLCBqb2JJZDogc3RyaW5nfX0gYXJncyAtIEV4YWN0IHJlY292ZXJ5IGZlbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZW1lbWJlckhhbmRvZmZSZWNvdmVyeSh7aGFuZG9mZklkLCBqb2JJZH0pIHtcbiAgICB0aGlzLnBlbmRpbmdIYW5kb2ZmUmVjb3Zlcmllcy5zZXQoaGFuZG9mZklkLCBqb2JJZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIG9uZSBleGFjdCBsZWFzZSBhbmQgZm9yZ2V0cyBpdCBvbmx5IGFmdGVyIHRoZSBhZGFwdGVyIGFja25vd2xlZGdlc1xuICAgKiB0aGUgZmVuY2VkIHRyYW5zaXRpb24gb3IgY29uZmlybXMgaXQgd2FzIGFscmVhZHkgYWJzZW50LlxuICAgKiBAcGFyYW0ge3toYW5kb2ZmSWQ6IHN0cmluZywgam9iSWQ6IHN0cmluZ319IGFyZ3MgLSBFeGFjdCByZWNvdmVyeSBmZW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZHVyYWJsZSByZWNvdmVyeSBzZXR0bGVzLlxuICAgKi9cbiAgYXN5bmMgX3JlY292ZXJIYW5kb2ZmKHtoYW5kb2ZmSWQsIGpvYklkfSkge1xuICAgIGF3YWl0IHRoaXMuc3RvcmUubWFya1JldHVybmVkVG9RdWV1ZSh7aGFuZG9mZklkLCBqb2JJZH0pXG5cbiAgICBpZiAodGhpcy5wZW5kaW5nSGFuZG9mZlJlY292ZXJpZXMuZ2V0KGhhbmRvZmZJZCkgPT09IGpvYklkKSB7XG4gICAgICB0aGlzLnBlbmRpbmdIYW5kb2ZmUmVjb3Zlcmllcy5kZWxldGUoaGFuZG9mZklkKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBsYXlzIHJldGFpbmVkIGV4YWN0LUlEIHJlY292ZXJpZXMgdGhyb3VnaCB0aGUgZGlzcGF0Y2hlcidzIGV4aXN0aW5nXG4gICAqIHRyYW5zaWVudC1lcnJvciByZXRyeSBsaWZlY3ljbGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGV2ZXJ5IHJldGFpbmVkIHJlY292ZXJ5IHNldHRsZXMuXG4gICAqL1xuICBhc3luYyBfcmV0cnlQZW5kaW5nSGFuZG9mZlJlY292ZXJpZXMoKSB7XG4gICAgZm9yIChjb25zdCBbaGFuZG9mZklkLCBqb2JJZF0gb2YgWy4uLnRoaXMucGVuZGluZ0hhbmRvZmZSZWNvdmVyaWVzXSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5fcmVjb3ZlckhhbmRvZmYoe2hhbmRvZmZJZCwgam9iSWR9KVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5fcmVwb3J0SGFuZG9mZlJlY292ZXJ5RXJyb3Ioe2Vycm9yLCBoYW5kb2ZmSWQsIGpvYklkfSlcbiAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU3VyZmFjZXMgYSBmYWlsZWQgZXhhY3QtSUQgcmVjb3Zlcnkgd2l0aG91dCBkcm9wcGluZyBpdHMgcmV0cnkgbGVkZ2VyIGVudHJ5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJlY292ZXJ5IGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuZXJyb3IgLSBBZGFwdGVyIGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmhhbmRvZmZJZCAtIEV4YWN0IGxlYXNlIGZlbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVwb3J0SGFuZG9mZlJlY292ZXJ5RXJyb3Ioe2Vycm9yLCBoYW5kb2ZmSWQsIGpvYklkfSkge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKVxuICAgIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgICBjb250ZXh0OiB7aGFuZG9mZklkLCBqb2JJZCwgc3RhZ2U6IFwiYmFja2dyb3VuZC1qb2ItaGFuZG9mZi1hZG1pc3Npb24tcmVjb3ZlcnlcIn0sXG4gICAgICBlcnJvcjogbm9ybWFsaXplZEVycm9yXG4gICAgfVxuICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIkZhaWxlZCB0byByZWNvdmVyIGFuIGFtYmlndW91cyBiYWNrZ3JvdW5kIGpvYiBoYW5kb2ZmOlwiLCBub3JtYWxpemVkRXJyb3JdKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbmV4dCBhdmFpbGFibGUgam9iIGZvciByZWFkeSB3b3JrZXJzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBOZXh0IHF1ZXVlZCBqb2IgbWF0Y2hpbmcgcmVhZHkgd29ya2VyIGNhcGFjaXR5LlxuICAgKi9cbiAgYXN5bmMgbmV4dEF2YWlsYWJsZUpvYkZvclJlYWR5V29ya2VycygpIHtcbiAgICBjb25zdCBleGVjdXRpb25Nb2RlcyA9IHRoaXMucmVhZHlXb3JrZXJFeGVjdXRpb25Nb2RlcygpXG5cbiAgICBpZiAoZXhlY3V0aW9uTW9kZXMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbFxuICAgIGlmIChleGVjdXRpb25Nb2Rlcy5sZW5ndGggPT09IFdPUktFUl9FWEVDVVRJT05fTU9ERV9DQVBBQklMSVRJRVMubGVuZ3RoKSByZXR1cm4gYXdhaXQgdGhpcy5zdG9yZS5uZXh0QXZhaWxhYmxlSm9iKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLnN0b3JlLm5leHRBdmFpbGFibGVKb2Ioe2V4ZWN1dGlvbk1vZGU6IGV4ZWN1dGlvbk1vZGVzfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlYWR5IHdvcmtlciBleGVjdXRpb24gbW9kZXMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlW119IC0gRXhlY3V0aW9uIG1vZGVzIGN1cnJlbnRseSBhY2NlcHRlZCBieSByZWFkeSB3b3JrZXJzLlxuICAgKi9cbiAgcmVhZHlXb3JrZXJFeGVjdXRpb25Nb2RlcygpIHtcbiAgICBjb25zdCBleGVjdXRpb25Nb2RlcyA9IG5ldyBTZXQoKVxuXG4gICAgZm9yIChjb25zdCB3b3JrZXIgb2YgdGhpcy5yZWFkeVdvcmtlcnMpIHtcbiAgICAgIHRoaXMuX2FkZEFjY2VwdGVkRXhlY3V0aW9uTW9kZXMoe2V4ZWN1dGlvbk1vZGVzLCB3b3JrZXJ9KVxuICAgIH1cblxuICAgIHJldHVybiAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGVbXX0gKi8gKFsuLi5leGVjdXRpb25Nb2Rlc10pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZGQgYWNjZXB0ZWQgZXhlY3V0aW9uIG1vZGVzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7U2V0PGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGU+fSBhcmdzLmV4ZWN1dGlvbk1vZGVzIC0gQWNjZXB0ZWQgbW9kZXMuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy53b3JrZXIgLSBXb3JrZXIgc29ja2V0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9hZGRBY2NlcHRlZEV4ZWN1dGlvbk1vZGVzKHtleGVjdXRpb25Nb2Rlcywgd29ya2VyfSkge1xuICAgIGlmICghd29ya2VyLnN1cHBvcnRzSGFuZG9mZklkUmVwb3J0aW5nKSByZXR1cm5cblxuICAgIGZvciAoY29uc3QgY2FwYWJpbGl0eSBvZiBXT1JLRVJfRVhFQ1VUSU9OX01PREVfQ0FQQUJJTElUSUVTKSB7XG4gICAgICBpZiAoY2FwYWJpbGl0eS5hY2NlcHRzKHdvcmtlcikpIGV4ZWN1dGlvbk1vZGVzLmFkZChjYXBhYmlsaXR5LmV4ZWN1dGlvbk1vZGUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVhZHkgd29ya2VyIGZvciBqb2IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBqb2IgLSBKb2IgYmVpbmcgaGFuZGVkIG9mZi5cbiAgICogQHJldHVybnMge0pzb25Tb2NrZXQgfCB1bmRlZmluZWR9IC0gUmVhZHkgd29ya2VyIGZvciB0aGUgam9iIHR5cGUuXG4gICAqL1xuICByZWFkeVdvcmtlckZvckpvYihqb2IpIHtcbiAgICBmb3IgKGNvbnN0IHdvcmtlciBvZiB0aGlzLnJlYWR5V29ya2Vycykge1xuICAgICAgaWYgKHRoaXMuX3dvcmtlckFjY2VwdHNKb2Ioe2pvYiwgd29ya2VyfSkpIHJldHVybiB3b3JrZXJcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyB3b3JrZXIgYWNjZXB0cyBqb2IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGFyZ3Muam9iIC0gSm9iIGJlaW5nIGhhbmRlZCBvZmYuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy53b3JrZXIgLSBXb3JrZXIgc29ja2V0LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSB3b3JrZXIgYWNjZXB0cyB0aGUgam9iIG1vZGUuXG4gICAqL1xuICBfd29ya2VyQWNjZXB0c0pvYih7am9iLCB3b3JrZXJ9KSB7XG4gICAgaWYgKCF3b3JrZXIuc3VwcG9ydHNIYW5kb2ZmSWRSZXBvcnRpbmcpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgY2FwYWJpbGl0eSA9IFdPUktFUl9FWEVDVVRJT05fTU9ERV9DQVBBQklMSVRJRVNfQllfTU9ERS5nZXQoam9iLmV4ZWN1dGlvbk1vZGUpXG5cbiAgICBpZiAoIWNhcGFiaWxpdHkpIHJldHVybiBmYWxzZVxuXG4gICAgcmV0dXJuIGNhcGFiaWxpdHkuYWNjZXB0cyh3b3JrZXIpXG4gIH1cblxuICAvKipcbiAgICogQXJtcyBhIHNpbmdsZSBgc2V0VGltZW91dGAgZm9yIHRoZSBzb29uZXN0IGZ1dHVyZS1zY2hlZHVsZWQgam9iJ3NcbiAgICogYHNjaGVkdWxlZF9hdF9tc2AuIFJlcGxhY2VzIHRoZSBzZWNvbmQgcmVzcG9uc2liaWxpdHkgb2YgdGhlIGxlZ2FjeVxuICAgKiAxLXNlY29uZCBwb2xsIChiZWNvbWluZy1lbGlnaWJsZSBzY2hlZHVsZWQgam9icykuIFRoZSB0aW1lciBpc1xuICAgKiBpZGVtcG90ZW50bHkgcmUtYXJtZWQgYXQgdGhlIGVuZCBvZiBldmVyeSBkcmFpbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfYXJtU2NoZWR1bGVkVGltZXIoKSB7XG4gICAgaWYgKHRoaXMuX3NjaGVkdWxlZFRpbWVyKSB7XG4gICAgICB0aGlzLmNsb2NrLmNsZWFyVGltZW91dCh0aGlzLl9zY2hlZHVsZWRUaW1lcilcbiAgICAgIHRoaXMuX3NjaGVkdWxlZFRpbWVyID0gdW5kZWZpbmVkXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX3N0b3BwZWQgfHwgdGhpcy5saWZlY3ljbGVTdGF0ZSAhPT0gXCJhY3RpdmVcIiB8fCAhdGhpcy5fYWN0aXZlT3duZXJzaGlwUmVhZHkpIHJldHVyblxuICAgIGlmICh0aGlzLmRpc3BhdGNoU3RyYXRlZ3kgPT09IFwicG9sbGluZ1wiKSByZXR1cm5cblxuICAgIGNvbnN0IG5leHQgPSBhd2FpdCB0aGlzLnN0b3JlLm5leHRTY2hlZHVsZWRKb2IoKVxuICAgIGxldCBkZWxheVxuXG4gICAgaWYgKG5leHQgJiYgdHlwZW9mIG5leHQuc2NoZWR1bGVkQXRNcyA9PT0gXCJudW1iZXJcIikge1xuICAgICAgZGVsYXkgPSBNYXRoLm1heCgwLCBNYXRoLm1pbihuZXh0LnNjaGVkdWxlZEF0TXMgLSB0aGlzLmNsb2NrLm5vdygpLCBNQVhfVElNRVJfTVMpKVxuICAgIH1cblxuICAgIC8vIGBuZXh0U2NoZWR1bGVkSm9iYCBvbmx5IHJldHVybnMgZnV0dXJlIGpvYnMsIHNvIGEgam9iIHRoYXQgYmVjYW1lXG4gICAgLy8gZWxpZ2libGUgYWZ0ZXIgdGhlIGRyYWluJ3MgZWxpZ2libGUtam9iIHByb2JlIGlzIGludmlzaWJsZSB0byBpdC4gSWYgb25lXG4gICAgLy8gaXMgZGlzcGF0Y2hhYmxlIG5vdywgYXJtIGEgMC1kZWxheSByZS1kcmFpbiBzbyBpdCBpcyBkaXNwYXRjaGVkXG4gICAgLy8gaW1tZWRpYXRlbHkgaW5zdGVhZCBvZiBiZWluZyBzdHJhbmRlZCB1bnRpbCB0aGUgbmV4dCBmdXR1cmUgdGltZXIgKG9yXG4gICAgLy8gZXh0ZXJuYWwgc2lnbmFsKSBmaXJlcy5cbiAgICBpZiAoYXdhaXQgdGhpcy5uZXh0QXZhaWxhYmxlSm9iRm9yUmVhZHlXb3JrZXJzKCkpIGRlbGF5ID0gMFxuXG4gICAgaWYgKHR5cGVvZiBkZWxheSAhPT0gXCJudW1iZXJcIikgcmV0dXJuXG5cbiAgICB0aGlzLl9zY2hlZHVsZWRUaW1lciA9IHRoaXMuY2xvY2suc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0aGlzLl9zY2hlZHVsZWRUaW1lciA9IHVuZGVmaW5lZFxuICAgICAgdm9pZCB0aGlzLl9kcmFpbigpXG4gICAgfSwgZGVsYXkpXG4gIH1cblxuICBhc3luYyBfc3dlZXBPcnBoYW5zKCkge1xuICAgIHRyeSB7XG4gICAgICBsZXQgb3JwaGFuZWRKb2JzXG5cbiAgICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCkge1xuICAgICAgICBjb25zdCBjb25uZWN0ZWRXb3JrZXJJZHMgPSBuZXcgU2V0KClcbiAgICAgICAgZm9yIChjb25zdCB3b3JrZXIgb2YgdGhpcy53b3JrZXJzKSB7XG4gICAgICAgICAgaWYgKHdvcmtlci53b3JrZXJJZCkgY29ubmVjdGVkV29ya2VySWRzLmFkZCh3b3JrZXIud29ya2VySWQpXG4gICAgICAgIH1cbiAgICAgICAgZm9yIChjb25zdCB3b3JrZXJJZCBvZiB0aGlzLmRpc2Nvbm5lY3RlZFdvcmtlcnMua2V5cygpKSBjb25uZWN0ZWRXb3JrZXJJZHMuYWRkKHdvcmtlcklkKVxuXG4gICAgICAgIGNvbnN0IGN1dG9mZiA9IHRoaXMuY2xvY2subm93KCkgLSBHRU5FUkFUSU9OX09SUEhBTkVEX0FGVEVSX01TXG4gICAgICAgIGNvbnN0IGhhbmRvZmZzID0gKGF3YWl0IHRoaXMuX2dlbmVyYXRpb25Pd25lZEhhbmRvZmZTbmFwc2hvdCgpKS5maWx0ZXIoKGhhbmRvZmYpID0+IHtcbiAgICAgICAgICByZXR1cm4gaGFuZG9mZi5oYW5kZWRPZmZBdE1zIDw9IGN1dG9mZiAmJiAhY29ubmVjdGVkV29ya2VySWRzLmhhcyhoYW5kb2ZmLndvcmtlcklkKVxuICAgICAgICB9KVxuICAgICAgICBvcnBoYW5lZEpvYnMgPSBoYW5kb2Zmcy5sZW5ndGggPT09IDBcbiAgICAgICAgICA/IFtdXG4gICAgICAgICAgOiBhd2FpdCB0aGlzLnN0b3JlLm1hcmtPcnBoYW5lZEhhbmRvZmZzKHtoYW5kb2ZmcywgZXJyb3I6IFwiSm9iIG9ycGhhbmVkIGFmdGVyIGl0cyBnZW5lcmF0aW9uIG93bmVyIGRpc2FwcGVhcmVkXCJ9KVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgb3JwaGFuZWRKb2JzID0gYXdhaXQgdGhpcy5zdG9yZS5tYXJrT3JwaGFuZWRKb2JzKClcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5faGFuZGxlT3JwaGFuZWRKb2JzKHtqb2JzOiBvcnBoYW5lZEpvYnMsIHdhcm5pbmc6IFwiTWFya2VkIG9ycGhhbmVkIGJhY2tncm91bmQgam9ic1wifSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG4gICAgICBjb25zdCBwYXlsb2FkID0ge2NvbnRleHQ6IHtnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkLCBzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi1vcnBoYW4tc3dlZXBcIn0sIGVycm9yOiBub3JtYWxpemVkRXJyb3J9XG4gICAgICBjb25zdCBlcnJvckV2ZW50cyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpXG5cbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIkZhaWxlZCB0byBtYXJrIG9ycGhhbmVkIGpvYnM6XCIsIG5vcm1hbGl6ZWRFcnJvcl0pXG4gICAgICBlcnJvckV2ZW50cy5lbWl0KFwiZnJhbWV3b3JrLWVycm9yXCIsIHBheWxvYWQpXG4gICAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuICAgIH1cblxuICAgIGlmICh0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcImFjdGl2ZVwiKSBhd2FpdCB0aGlzLl9yZWNvbmNpbGVBY3RpdmVDb25jdXJyZW5jeSgpXG4gIH1cblxuICAvKipcbiAgICogUmVwYWlycyBkdXJhYmxlIGFkbWlzc2lvbiBjb3VudGVycyBvbiB0aGUgYWN0aXZlIG1haW4ncyBtYWludGVuYW5jZSBjYWRlbmNlXG4gICAqIGFuZCBpbW1lZGlhdGVseSByZXRyaWVzIGRpc3BhdGNoIHdoZW4gY2FwYWNpdHkgd2FzIHJlY292ZXJlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcmVwYWlyIGFuZCBhbnkgcmVzdWx0aW5nIGRyYWluLlxuICAgKi9cbiAgYXN5bmMgX3JlY29uY2lsZUFjdGl2ZUNvbmN1cnJlbmN5KCkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnN0b3JlLnJlY29uY2lsZUFjdGl2ZUNvbmN1cnJlbmN5KClcblxuICAgICAgaWYgKHJlc3VsdC5yZXBhaXJlZENvdW50ID4gMCkgYXdhaXQgdGhpcy5fZHJhaW4oKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICAgIGNvbnN0IHBheWxvYWQgPSB7Y29udGV4dDoge2dlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWQsIHN0YWdlOiBcImJhY2tncm91bmQtam9iLWNvbmN1cnJlbmN5LXJlY29uY2lsaWF0aW9uXCJ9LCBlcnJvcjogbm9ybWFsaXplZEVycm9yfVxuICAgICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJGYWlsZWQgdG8gcmVjb25jaWxlIGJhY2tncm91bmQgam9iIGFjdGl2ZS1jb25jdXJyZW5jeSBjb3VudHM6XCIsIG5vcm1hbGl6ZWRFcnJvcl0pXG4gICAgICBlcnJvckV2ZW50cy5lbWl0KFwiZnJhbWV3b3JrLWVycm9yXCIsIHBheWxvYWQpXG4gICAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQdWJsaXNoZXMgdGhlIGNvbW1vbiBwb3N0LW9ycGhhbiBsaWZlY3ljbGU6IHdha2UgcXVldWVkIHJldHJpZXMsIGVtaXQgb25lXG4gICAqIGlzb2xhdGVkIGV2ZW50IHBlciBhY2NlcHRlZCB0cmFuc2l0aW9uLCBhbmQgZHJhaW4gc28gcmVsZWFzZWQgY29uY3VycmVuY3lcbiAgICogY2FuIGltbWVkaWF0ZWx5IGFkbWl0IG90aGVyIHdvcmsuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3dbXX0gYXJncy5qb2JzIC0gQWNjZXB0ZWQgb3JwaGFuIHRyYW5zaXRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy53YXJuaW5nIC0gTGlmZWN5Y2xlIGxvZyBtZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgcmVzdWx0aW5nIGRyYWluLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZU9ycGhhbmVkSm9icyh7am9icywgd2FybmluZ30pIHtcbiAgICBpZiAoam9icy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRoaXMuX21heWJlU3RvcFJldGlyZWQoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5sb2dnZXIud2FybigoKSA9PiBbd2FybmluZywgam9icy5sZW5ndGhdKVxuICAgIC8vIFJlY2xhaW1lZCBvcnBoYW5zIGNhbiBiZWNvbWUgYHF1ZXVlZGAgYWdhaW4g4oCUIHdha2UgdGhlIGRpc3BhdGNoZXIgZmlyc3RcbiAgICAvLyBzbyBhbiBhcHBsaWNhdGlvbiBldmVudCBoYW5kbGVyIHRoYXQgdGhyb3dzIGJlbG93IGNhbm5vdCBzdHJhbmQgdGhlbS5cbiAgICB0aGlzLl9ub3RpZnlFbnF1ZXVlZCgpXG4gICAgLy8gRW1pdCBiZWZvcmUgYXdhaXRpbmcgdGhlIGRyYWluIHNvIGEgYmxvY2tlZCBkaXNwYXRjaGVyIGNhbm5vdCBkZWxheVxuICAgIC8vIGFwcGxpY2F0aW9uIHJlY292ZXJ5LiBJc29sYXRlIGhhbmRsZXJzIHNvIG9uZSBjYW5ub3Qgc3VwcHJlc3MgdGhlIHJlc3QuXG4gICAgZm9yIChjb25zdCBqb2Igb2Ygam9icykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgdGhpcy5fZW1pdEJhY2tncm91bmRKb2JPcnBoYW5lZCh7am9ifSlcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIkEgYmFja2dyb3VuZC1qb2Itb3JwaGFuZWQgZXZlbnQgaGFuZGxlciB0aHJldzpcIiwgZXJyb3JdKVxuICAgICAgfVxuICAgIH1cbiAgICBhd2FpdCB0aGlzLl9kcmFpbigpXG4gICAgdGhpcy5fbWF5YmVTdG9wUmV0aXJlZCgpXG4gIH1cblxuICAvKipcbiAgICogRHJvcHMgd29ya2VycyB0aGF0IGhhdmUgZ29uZSBzaWxlbnQgcGFzdCBgd29ya2VyU3RhbGVUaW1lb3V0TXNgIChub1xuICAgKiBoZWFydGJlYXQsIHJlYWR5LCBvciByZXBvcnQpLiBBIHdlZGdlZCB3b3JrZXIga2VlcHMgaXRzIHNvY2tldCBvcGVuLCBzbyB0aGVcbiAgICogYGNsb3NlYC1iYXNlZCBjbGVhbnVwIG5ldmVyIGZpcmVzIGFuZCBpdHMgaW4tZmxpZ2h0IGxlYXNlcyDigJQgYW5kIHRoZSB3aG9sZVxuICAgKiBxdWV1ZSDigJQgc3RheSBzdHVjayB1bnRpbCBhIGh1bWFuIG5vdGljZXMuIFJlbGVhc2luZyB0aGUgbG9zdCB3b3JrZXInc1xuICAgKiBsZWFzZXMgbGV0cyBpdHMgam9icyBydW4gZWxzZXdoZXJlIGFuZCBzdG9wcyBkaXNwYXRjaCB0byBpdDsgdGhlIHdvcmtlcidzXG4gICAqIG93biBwcm9jZXNzIGxpZmVjeWNsZSBpcyB0aGUgc3VwZXJ2aXNvcidzIGNvbmNlcm4uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSBzd2VlcC5cbiAgICovXG4gIGFzeW5jIF9zd2VlcFN0YWxlV29ya2VycygpIHtcbiAgICBpZiAodGhpcy5fc3RvcHBlZCkgcmV0dXJuXG5cbiAgICBjb25zdCBjdXRvZmYgPSB0aGlzLmNsb2NrLm5vdygpIC0gdGhpcy53b3JrZXJTdGFsZVRpbWVvdXRNc1xuICAgIC8qKiBAdHlwZSB7SnNvblNvY2tldFtdfSAqL1xuICAgIGNvbnN0IHN0YWxlID0gW11cblxuICAgIGZvciAoY29uc3Qgd29ya2VyIG9mIHRoaXMud29ya2Vycykge1xuICAgICAgLy8gT25seSBldmljdCBoZWFydGJlYXQtY2FwYWJsZSB3b3JrZXJzLiBBIGxlZ2FjeSB3b3JrZXIgKGUuZy4gb25lIGZyb20gdGhlXG4gICAgICAvLyBwcmV2aW91cyByZWxlYXNlIGR1cmluZyBhIHJvbGxpbmcgZGVwbG95KSBuZXZlciBoZWFydGJlYXRzLCBzbyBldmljdGluZ1xuICAgICAgLy8gaXQgb24gc2lsZW5jZSB3b3VsZCB3cm9uZ2x5IHJlbGVhc2UgdGhlIGxlYXNlcyBvZiBhIGpvYiBpdCBpcyBzdGlsbFxuICAgICAgLy8gcnVubmluZy4gSXRzIGRpc2Nvbm5lY3QgaXMgc3RpbGwgaGFuZGxlZCBieSB0aGUgc29ja2V0IGBjbG9zZWAgcGF0aC5cbiAgICAgIGlmICghd29ya2VyLnN1cHBvcnRzSGVhcnRiZWF0KSBjb250aW51ZVxuXG4gICAgICBjb25zdCBsYXN0U2VlbkF0ID0gdHlwZW9mIHdvcmtlci5sYXN0U2VlbkF0ID09PSBcIm51bWJlclwiID8gd29ya2VyLmxhc3RTZWVuQXQgOiAwXG5cbiAgICAgIGlmIChsYXN0U2VlbkF0IDw9IGN1dG9mZikgc3RhbGUucHVzaCh3b3JrZXIpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCB3b3JrZXIgb2Ygc3RhbGUpIHtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oKCkgPT4gW1wiRHJvcHBpbmcgc3RhbGUgYmFja2dyb3VuZCBqb2JzIHdvcmtlclwiLCB7d29ya2VySWQ6IHdvcmtlci53b3JrZXJJZCwgbGFzdFNlZW5BdDogd29ya2VyLmxhc3RTZWVuQXR9XSlcblxuICAgICAgdHJ5IHtcbiAgICAgICAgd29ya2VyLmNsb3NlKClcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBBbHJlYWR5IGNsb3Npbmc7IHRoZSBsZWFzZSByZWxlYXNlIGJlbG93IGlzIHdoYXQgbWF0dGVycy5cbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5faGFuZGxlV29ya2VyU29ja2V0Q2xvc2VkKHdvcmtlcilcbiAgICB9XG4gIH1cbn1cbiJdfQ==