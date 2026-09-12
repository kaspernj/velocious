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
        if (this.lifecycleState === expectedLifecycleState)
            this._setupStartupHandoffReclaim();
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9iYWNrZ3JvdW5kLWpvYnMvbWFpbi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFFLFVBQVUsRUFBRSxNQUFNLFFBQVEsQ0FBQTtBQUNuQyxPQUFPLEdBQUcsTUFBTSxLQUFLLENBQUE7QUFDckIsT0FBTyxVQUFVLE1BQU0sa0JBQWtCLENBQUE7QUFDekMsT0FBTyx1QkFBdUIsTUFBTSxnQkFBZ0IsQ0FBQTtBQUNwRCxPQUFPLE1BQU0sTUFBTSxjQUFjLENBQUE7QUFDakMsT0FBTyw4QkFBOEIsTUFBTSwyQ0FBMkMsQ0FBQTtBQUN0RixPQUFPLGNBQWMsTUFBTSx1QkFBdUIsQ0FBQTtBQUNsRCxPQUFPLGlCQUFpQixFQUFFLEVBQUUsZ0JBQWdCLEVBQUUsTUFBTSxnQ0FBZ0MsQ0FBQTtBQUNwRixPQUFPLEVBQUUsb0JBQW9CLEVBQUUsMkJBQTJCLEVBQUUsTUFBTSwwQkFBMEIsQ0FBQTtBQUM1RixPQUFPLG9DQUFvQyxNQUFNLCtCQUErQixDQUFBO0FBRWhGOzs7OztHQUtHO0FBQ0g7Ozs7OztHQU1HO0FBQ0gsTUFBTSxnQkFBZ0IsR0FBRyxvQ0FBb0MsQ0FBQTtBQUU3RDs7OztHQUlHO0FBQ0gsTUFBTSxZQUFZLEdBQUcsYUFBYSxDQUFBLENBQUMsYUFBYTtBQUNoRCwrRUFBK0U7QUFDL0UsTUFBTSx1QkFBdUIsR0FBRyxLQUFLLENBQUE7QUFDckMsc0RBQXNEO0FBQ3RELE1BQU0sd0JBQXdCLEdBQUcsS0FBSyxDQUFBO0FBQ3RDLHlGQUF5RjtBQUN6RixNQUFNLHlCQUF5QixHQUFHLEtBQUssQ0FBQTtBQUN2QyxNQUFNLDRCQUE0QixHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsSUFBSSxDQUFBO0FBQ25ELE1BQU0seUNBQXlDLEdBQUcsMkRBQTJELFlBQVksRUFBRSxDQUFBO0FBRTNIOzs7OztHQUtHO0FBQ0gsU0FBUywrQkFB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UUFDM0QsMkJBQTJCO1FBQzNCLE1BQU0sS0FBSyxHQUFHLEVBQUUsQ0FBQTtRQUVoQixLQUFLLE1BQU0sTUFBTSxJQUFJLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUNsQywyRUFBMkU7WUFDM0UsMEVBQTBFO1lBQzFFLHNFQUFzRTtZQUN0RSx1RUFBdUU7WUFDdkUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxpQkFBaUI7Z0JBQUUsU0FBUTtZQUV2QyxNQUFNLFVBQVUsR0FBRyxPQUFPLE1BQU0sQ0FBQyxVQUFVLEtBQUssUUFBUSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUE7WUFFaEYsSUFBSSxVQUFVLElBQUksTUFBTTtnQkFBRSxLQUFLLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBQzlDLENBQUM7UUFFRCxLQUFLLE1BQU0sTUFBTSxJQUFJLEtBQUssRUFBRSxDQUFDO1lBQzNCLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsdUNBQXVDLEVBQUUsRUFBQyxRQUFRLEVBQUUsTUFBTSxDQUFDLFFBQVEsRUFBRSxVQUFVLEVBQUUsTUFBTSxDQUFDLFVBQVUsRUFBQyxDQUFDLENBQUMsQ0FBQTtZQUU3SCxJQUFJLENBQUM7Z0JBQ0gsTUFBTSxDQUFDLEtBQUssRUFBRSxDQUFBO1lBQ2hCLENBQUM7WUFBQyxNQUFNLENBQUM7Z0JBQ1AsNERBQTREO1lBQzlELENBQUM7WUFFRCxNQUFNLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUM5QyxDQUFDO0lBQ0gsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tIFwiY3J5cHRvXCJcbmltcG9ydCBuZXQgZnJvbSBcIm5ldFwiXG5pbXBvcnQgSnNvblNvY2tldCBmcm9tIFwiLi9qc29uLXNvY2tldC5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYnNTY2hlZHVsZXIgZnJvbSBcIi4vc2NoZWR1bGVyLmpzXCJcbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uL2xvZ2dlci5qc1wiXG5pbXBvcnQgUHJ1bmVUZXJtaW5hbEJhY2tncm91bmRKb2JzSm9iIGZyb20gXCIuLi9qb2JzL3BydW5lLXRlcm1pbmFsLWJhY2tncm91bmQtam9icy5qc1wiXG5pbXBvcnQgVmVsb2Npb3VzRXJyb3IgZnJvbSBcIi4uL3ZlbG9jaW91cy1lcnJvci5qc1wiXG5pbXBvcnQgc2h1dGRvd25MaWZlY3ljbGUsIHsgcnVuU2h1dGRvd25TdGVwcyB9IGZyb20gXCIuLi91dGlscy9zaHV0ZG93bi1saWZlY3ljbGUuanNcIlxuaW1wb3J0IHsgdmFsaWRhdGVHZW5lcmF0aW9uSWQsIHdvcmtlcklkQmVsb25nc1RvR2VuZXJhdGlvbiB9IGZyb20gXCIuL2dlbmVyYXRpb24taWRlbnRpdHkuanNcIlxuaW1wb3J0IEJhY2tncm91bmRKb2JzTGlmZWN5Y2xlQ29udHJvbFNlcnZlciBmcm9tIFwiLi9saWZlY3ljbGUtY29udHJvbC1zZXJ2ZXIuanNcIlxuXG4vKipcbiAqIFdvcmtlckV4ZWN1dGlvbk1vZGVDYXBhYmlsaXR5IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBXb3JrZXJFeGVjdXRpb25Nb2RlQ2FwYWJpbGl0eVxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlfSBleGVjdXRpb25Nb2RlIC0gRXhlY3V0aW9uIG1vZGUuXG4gKiBAcHJvcGVydHkgeyh3b3JrZXI6IEpzb25Tb2NrZXQpID0+IGJvb2xlYW59IGFjY2VwdHMgLSBXaGV0aGVyIHRoZSB3b3JrZXIgYWNjZXB0cyB0aGlzIG1vZGUuXG4gKi9cbi8qKlxuICogQ2hhbm5lbCB1c2VkIGJ5IGBiYWNrZ3JvdW5kLWpvYnMtbWFpbmAgdG8gY29vcmRpbmF0ZSBkaXNwYXRjaCB3YWtlLXVwc1xuICogYWNyb3NzIHByb2Nlc3NlcyB2aWEgQmVhY29uLiBXb3JrZXJzIGRvIE5PVCBzdWJzY3JpYmUgdG8gdGhpcyBjaGFubmVsXG4gKiDigJQgdGhleSBhbHJlYWR5IHJlY2VpdmUgam9iLWhhbmRvZmYgbWVzc2FnZXMgb24gdGhlaXIgSnNvblNvY2tldCB0b1xuICogbWFpbjsgdGhpcyBjaGFubmVsIGV4aXN0cyBzbyBjcm9zcy1wcm9jZXNzIGVucXVldWVzIChvciBmdXR1cmVcbiAqIG11bHRpLW1haW4gZGVwbG95bWVudHMpIGNhbiBwb2tlIGFuIGlkbGUgbWFpbiB0byBkcmFpbi5cbiAqL1xuY29uc3QgRElTUEFUQ0hfQ0hBTk5FTCA9IFwidmVsb2Npb3VzLWJhY2tncm91bmQtam9icy1kaXNwYXRjaFwiXG5cbi8qKlxuICogYHNldFRpbWVvdXRgIGlzIGltcGxlbWVudGVkIHdpdGggMzItYml0IHNpZ25lZCBkZWxheXMgb24gTm9kZTsgcGFzc2luZ1xuICogYW55dGhpbmcgbGFyZ2VyIHNpbGVudGx5IGNsYW1wcyB0byAxbXMgYW5kIGZpcmVzIGltbWVkaWF0ZWx5LiBDYXAgdGhlXG4gKiBzY2hlZHVsZWQtam9iIHRpbWVyIGhlcmUgYW5kIHJlLWFybSB3aGVuIGl0IGV4cGlyZXMuXG4gKi9cbmNvbnN0IE1BWF9USU1FUl9NUyA9IDJfMTQ3XzQ4M182NDcgLy8gfjI0LjggZGF5c1xuLyoqIEEgd29ya2VyIHNpbGVudCAobm8gaGVhcnRiZWF0L3JlYWR5L3JlcG9ydCkgbG9uZ2VyIHRoYW4gdGhpcyBpcyBkcm9wcGVkLiAqL1xuY29uc3QgV09SS0VSX1NUQUxFX1RJTUVPVVRfTVMgPSA2MDAwMFxuLyoqIEhvdyBvZnRlbiB0aGUgbWFpbiBzY2FucyB3b3JrZXJzIGZvciBzdGFsZW5lc3MuICovXG5jb25zdCBXT1JLRVJfTElWRU5FU1NfU1dFRVBfTVMgPSAxNTAwMFxuLyoqIEdyYWNlIGZvciB3b3JrZXJzIGZyb20gdGhlIHByZXZpb3VzIG1haW4gZ2VuZXJhdGlvbiB0byByZWNvbm5lY3QgYW5kIGFkb3B0IGxlYXNlcy4gKi9cbmNvbnN0IFdPUktFUl9SRUNPTk5FQ1RfR1JBQ0VfTVMgPSAzMDAwMFxuY29uc3QgR0VORVJBVElPTl9PUlBIQU5FRF9BRlRFUl9NUyA9IDYwICogNjAgKiAxMDAwXG5jb25zdCBXT1JLRVJfUkVDT05ORUNUX0dSQUNFX1ZBTElEQVRJT05fTUVTU0FHRSA9IGB3b3JrZXJSZWNvbm5lY3RHcmFjZU1zIG11c3QgYmUgYW4gaW50ZWdlciBiZXR3ZWVuIDAgYW5kICR7TUFYX1RJTUVSX01TfWBcblxuLyoqXG4gKiBSZXNvbHZlcyBhIHN0YXJ0dXAgcmVjb25uZWN0IGdyYWNlIHdpdGhvdXQgYWxsb3dpbmcgTm9kZSdzIHRpbWVyIG92ZXJmbG93IHRvXG4gKiB0dXJuIGFuIGludGVudGlvbmFsbHkgbG9uZyBncmFjZSBpbnRvIGFuIGltbWVkaWF0ZSByZWNsYWltLlxuICogQHBhcmFtIHtudW1iZXIgfCB1bmRlZmluZWR9IHdvcmtlclJlY29ubmVjdEdyYWNlTXMgLSBSZXF1ZXN0ZWQgcmVjb25uZWN0IGdyYWNlLlxuICogQHJldHVybnMge251bWJlcn0gLSBWYWxpZCB0aW1lciBkZWxheS5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplV29ya2VyUmVjb25uZWN0R3JhY2VNcyh3b3JrZXJSZWNvbm5lY3RHcmFjZU1zKSB7XG4gIGlmICh3b3JrZXJSZWNvbm5lY3RHcmFjZU1zID09PSB1bmRlZmluZWQpIHJldHVybiBXT1JLRVJfUkVDT05ORUNUX0dSQUNFX01TXG4gIGlmICghTnVtYmVyLmlzSW50ZWdlcih3b3JrZXJSZWNvbm5lY3RHcmFjZU1zKSB8fCB3b3JrZXJSZWNvbm5lY3RHcmFjZU1zIDwgMCB8fCB3b3JrZXJSZWNvbm5lY3RHcmFjZU1zID4gTUFYX1RJTUVSX01TKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihXT1JLRVJfUkVDT05ORUNUX0dSQUNFX1ZBTElEQVRJT05fTUVTU0FHRSlcbiAgfVxuXG4gIHJldHVybiB3b3JrZXJSZWNvbm5lY3RHcmFjZU1zXG59XG4vKipcbiAqIFdvcmtlciBleGVjdXRpb24gbW9kZSBjYXBhYmlsaXRpZXMuXG4gKiBAdHlwZSB7V29ya2VyRXhlY3V0aW9uTW9kZUNhcGFiaWxpdHlbXX0gKi9cbmNvbnN0IFdPUktFUl9FWEVDVVRJT05fTU9ERV9DQVBBQklMSVRJRVMgPSBbXG4gIHtleGVjdXRpb25Nb2RlOiBcImlubGluZVwiLCBhY2NlcHRzOiAod29ya2VyKSA9PiB3b3JrZXIuYWNjZXB0c0lubGluZUpvYnMgIT09IGZhbHNlfSxcbiAge2V4ZWN1dGlvbk1vZGU6IFwiZm9ya2VkXCIsIGFjY2VwdHM6ICh3b3JrZXIpID0+IHdvcmtlci5hY2NlcHRzRm9ya2VkSm9icyAhPT0gZmFsc2V9LFxuICAvLyBQb29sZWQgaXMgb3B0LWluOiBvbmx5IHdvcmtlcnMgdGhhdCBleHBsaWNpdGx5IGFkdmVydGlzZSBgYWNjZXB0c1Bvb2xlZGBcbiAgLy8gcmVjZWl2ZSBwb29sZWQgam9icy4gVGhlIGA9PT0gdHJ1ZWAgKHJhdGhlciB0aGFuIGAhPT0gZmFsc2VgKSBjaGVjayBrZWVwcyBhXG4gIC8vIHByZS1wb29sZWQgd29ya2VyIOKAlCB3aGljaCBuZXZlciBzZW5kcyB0aGUgZmllbGQg4oCUIG91dCBvZiB0aGUgcG9vbGVkLWNhcGFibGVcbiAgLy8gc2V0LCBzbyB0aGUgbWFpbiBuZXZlciBkaXNwYXRjaGVzIGEgcG9vbGVkIGpvYiB0byBhIHdvcmtlciB0aGF0IGNhbm5vdCBydW5cbiAgLy8gb25lLiBUaGlzIGlzIHRoZSBjb25zZXJ2YXRpdmUgaGFsZiBvZiB0aGUgZXh0ZW5kZWQgcmVhZGluZXNzIHByb3RvY29sLlxuICB7ZXhlY3V0aW9uTW9kZTogXCJwb29sZWRcIiwgYWNjZXB0czogKHdvcmtlcikgPT4gd29ya2VyLmFjY2VwdHNQb29sZWRKb2JzID09PSB0cnVlICYmICghd29ya2VyLnVzZXNQb29sZWRDYXBhY2l0eUNyZWRpdHMgfHwgd29ya2VyLmF2YWlsYWJsZVBvb2xlZFNsb3RzID4gMCl9LFxuICB7ZXhlY3V0aW9uTW9kZTogXCJzcGF3bmVkXCIsIGFjY2VwdHM6ICh3b3JrZXIpID0+IHdvcmtlci5hY2NlcHRzU3Bhd25lZEpvYnMgIT09IGZhbHNlfVxuXVxuY29uc3QgV09SS0VSX0VYRUNVVElPTl9NT0RFX0NBUEFCSUxJVElFU19CWV9NT0RFID0gbmV3IE1hcChcbiAgV09SS0VSX0VYRUNVVElPTl9NT0RFX0NBUEFCSUxJVElFUy5tYXAoKGNhcGFiaWxpdHkpID0+IFtjYXBhYmlsaXR5LmV4ZWN1dGlvbk1vZGUsIGNhcGFiaWxpdHldKVxuKVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBCYWNrZ3JvdW5kSm9ic01haW4ge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhvc3RdIC0gSG9zdG5hbWUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5wb3J0XSAtIFBvcnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5nZW5lcmF0aW9uSWRdIC0gRXhwbGljaXQgcmVsZWFzZSBnZW5lcmF0aW9uIGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uSW5pdGlhbFN0YXRlfSBbYXJncy5pbml0aWFsR2VuZXJhdGlvblN0YXRlXSAtIEV4cGxpY2l0IGdlbmVyYXRpb24gYm9vdCBzdGF0ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmxpZmVjeWNsZVNvY2tldFBhdGhdIC0gRXhwbGljaXQgbGlmZWN5Y2xlIHNvY2tldCBwYXRoLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3Mud29ya2VyU3RhbGVUaW1lb3V0TXNdIC0gT3ZlcnJpZGUgaG93IGxvbmcgYSBzaWxlbnQgd29ya2VyIG1heSBnbyBiZWZvcmUgYmVpbmcgZHJvcHBlZCAoZGVmYXVsdCA2MDAwMG1zKS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLndvcmtlckxpdmVuZXNzU3dlZXBNc10gLSBPdmVycmlkZSBob3cgb2Z0ZW4gc3RhbGUgd29ya2VycyBhcmUgc3dlcHQgZm9yIChkZWZhdWx0IDE1MDAwbXMpLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3Mud29ya2VyUmVjb25uZWN0R3JhY2VNc10gLSBJbnRlZ2VyIGZyb20gMCB0aHJvdWdoIDIsMTQ3LDQ4Myw2NDcgb3ZlcnJpZGluZyBob3cgbG9uZyBwcmV2aW91cy1nZW5lcmF0aW9uIHdvcmtlcnMgbWF5IHJlY29ubmVjdCBiZWZvcmUgZXhhY3Qgc3RhcnR1cCBsZWFzZXMgYXJlIHJlY2xhaW1lZCAoZGVmYXVsdCAzMDAwMG1zKS5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3BdIC0gV2hldGhlciBzdG9wIG93bnMgY2xvc2luZyB0aGUgY29uZmlndXJhdGlvbidzIGRhdGFiYXNlIHBvb2xzIChkZWZhdWx0IHRydWUpLlxuICAgKiBAcGFyYW0geygpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+fSBbYXJncy5vblN0b3BwZWRdIC0gTGlmZWN5Y2xlIGhvb2sgaW52b2tlZCBhZnRlciB0aGUgbWFpbiBwcm9jZXNzIGZpbmlzaGVzIHN0b3BwaW5nLlxuICAgKiBAcGFyYW0geyhhcmdzOiB7aGFuZG9mZjogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGFuZG9mZiwgam9iOiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9KSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPn0gW2FyZ3MuYWZ0ZXJIYW5kb2ZmQ2xhaW1dIC0gRXhwbGljaXQgaGFuZG9mZi1jbGFpbSBvYnNlcnZhdGlvbiBob29rLlxuICAgKiBAcGFyYW0geyh3b3JrZXI6IEpzb25Tb2NrZXQpID0+IHZvaWR9IFthcmdzLm9uV29ya2VyUmVhZHldIC0gRXhwbGljaXQgcmVhZGluZXNzIG9ic2VydmF0aW9uIGhvb2suXG4gICAqIEBwYXJhbSB7KHdvcmtlcjogSnNvblNvY2tldCkgPT4gdm9pZH0gW2FyZ3Mub25Xb3JrZXJIZWFydGJlYXRdIC0gRXhwbGljaXQgaGVhcnRiZWF0IG9ic2VydmF0aW9uIGhvb2suXG4gICAqIEBwYXJhbSB7KHdvcmtlcklkOiBzdHJpbmcpID0+IHZvaWR9IFthcmdzLm9uV29ya2VyRGlzY29ubmVjdGVkXSAtIEV4cGxpY2l0IGdlbmVyYXRpb24gZGlzY29ubmVjdCBvYnNlcnZhdGlvbiBob29rLlxuICAgKiBAcGFyYW0geyh3b3JrZXJJZDogc3RyaW5nKSA9PiB2b2lkfSBbYXJncy5vbldvcmtlckhhbmRvZmZzUmVsZWFzZWRdIC0gRXhwbGljaXQgZ3JhY2UtZXhwaXJ5IG9ic2VydmF0aW9uIGhvb2suXG4gICAqIEBwYXJhbSB7KGpvYnM6IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd1tdKSA9PiB2b2lkfSBbYXJncy5vblN0YXJ0dXBIYW5kb2Zmc1JlY2xhaW1lZF0gLSBFeHBsaWNpdCBzdGFydHVwIHJlY2xhaW0gb2JzZXJ2YXRpb24gaG9vay5cbiAgICogQHBhcmFtIHsoYXJnczoge2FjY2VwdGVkOiBib29sZWFuLCBqb2JJZDogc3RyaW5nLCBzdGF0dXM6IFwiY29tcGxldGVkXCIgfCBcImZhaWxlZFwiIHwgXCJyZXNjaGVkdWxlZFwifSkgPT4gdm9pZH0gW2FyZ3Mub25Kb2JVcGRhdGVkXSAtIEV4cGxpY2l0IGR1cmFibGUgcmVwb3J0IG9ic2VydmF0aW9uIGhvb2suXG4gICAqIEBwYXJhbSB7e25vdzogKCkgPT4gbnVtYmVyLCBzZXRUaW1lb3V0PzogKGNhbGxiYWNrOiAoKSA9PiB2b2lkLCBkZWxheU1zOiBudW1iZXIpID0+IFJldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVtYmVyLCBjbGVhclRpbWVvdXQ/OiAodGltZXJJZDogUmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudW1iZXIpID0+IHZvaWR9fSBbYXJncy5jbG9ja10gLSBJbmplY3RhYmxlIHdhbGwgY2xvY2sgZm9yIGRldGVybWluaXN0aWMgbGlmZWN5Y2xlIHRlc3RzLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIGhvc3QsIHBvcnQsIGdlbmVyYXRpb25JZDogZXhwbGljaXRHZW5lcmF0aW9uSWQsIGluaXRpYWxHZW5lcmF0aW9uU3RhdGU6IGV4cGxpY2l0SW5pdGlhbEdlbmVyYXRpb25TdGF0ZSwgbGlmZWN5Y2xlU29ja2V0UGF0aDogZXhwbGljaXRMaWZlY3ljbGVTb2NrZXRQYXRoLCB3b3JrZXJTdGFsZVRpbWVvdXRNcywgd29ya2VyTGl2ZW5lc3NTd2VlcE1zLCB3b3JrZXJSZWNvbm5lY3RHcmFjZU1zLCBjbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3AgPSB0cnVlLCBvblN0b3BwZWQsIGFmdGVySGFuZG9mZkNsYWltLCBvbldvcmtlclJlYWR5LCBvbldvcmtlckhlYXJ0YmVhdCwgb25Xb3JrZXJEaXNjb25uZWN0ZWQsIG9uV29ya2VySGFuZG9mZnNSZWxlYXNlZCwgb25TdGFydHVwSGFuZG9mZnNSZWNsYWltZWQsIG9uSm9iVXBkYXRlZCwgY2xvY2t9KSB7XG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMuY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zT25TdG9wID0gY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zT25TdG9wXG4gICAgdGhpcy5vblN0b3BwZWQgPSBvblN0b3BwZWRcbiAgICB0aGlzLmFmdGVySGFuZG9mZkNsYWltID0gYWZ0ZXJIYW5kb2ZmQ2xhaW1cbiAgICB0aGlzLm9uV29ya2VyUmVhZHkgPSBvbldvcmtlclJlYWR5XG4gICAgdGhpcy5vbldvcmtlckhlYXJ0YmVhdCA9IG9uV29ya2VySGVhcnRiZWF0XG4gICAgdGhpcy5vbldvcmtlckRpc2Nvbm5lY3RlZCA9IG9uV29ya2VyRGlzY29ubmVjdGVkXG4gICAgdGhpcy5vbldvcmtlckhhbmRvZmZzUmVsZWFzZWQgPSBvbldvcmtlckhhbmRvZmZzUmVsZWFzZWRcbiAgICB0aGlzLm9uU3RhcnR1cEhhbmRvZmZzUmVjbGFpbWVkID0gb25TdGFydHVwSGFuZG9mZnNSZWNsYWltZWRcbiAgICB0aGlzLm9uSm9iVXBkYXRlZCA9IG9uSm9iVXBkYXRlZFxuICAgIHRoaXMuY2xvY2sgPSB7XG4gICAgICBjbGVhclRpbWVvdXQ6IGNsb2NrPy5jbGVhclRpbWVvdXQgfHwgKCh0aW1lcklkKSA9PiBjbGVhclRpbWVvdXQodGltZXJJZCkpLFxuICAgICAgbm93OiBjbG9jaz8ubm93IHx8ICgoKSA9PiBEYXRlLm5vdygpKSxcbiAgICAgIHNldFRpbWVvdXQ6IGNsb2NrPy5zZXRUaW1lb3V0IHx8ICgoY2FsbGJhY2ssIGRlbGF5TXMpID0+IHNldFRpbWVvdXQoY2FsbGJhY2ssIGRlbGF5TXMpKVxuICAgIH1cbiAgICBjb25zdCBjb25maWcgPSBjb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKClcbiAgICBjb25zdCBnZW5lcmF0aW9uQ29uZmlnID0gY29uZmlndXJhdGlvbi5yZXNvbHZlQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uQ29uZmlnKHtcbiAgICAgIGdlbmVyYXRpb25JZDogZXhwbGljaXRHZW5lcmF0aW9uSWQsXG4gICAgICBpbml0aWFsR2VuZXJhdGlvblN0YXRlOiBleHBsaWNpdEluaXRpYWxHZW5lcmF0aW9uU3RhdGUsXG4gICAgICBsaWZlY3ljbGVTb2NrZXRQYXRoOiBleHBsaWNpdExpZmVjeWNsZVNvY2tldFBhdGgsXG4gICAgICBzb3VyY2VOYW1lOiBcIkJhY2tncm91bmRKb2JzTWFpblwiXG4gICAgfSlcbiAgICB0aGlzLmdlbmVyYXRpb25JZCA9IGdlbmVyYXRpb25Db25maWcuZ2VuZXJhdGlvbklkXG4gICAgdGhpcy5pbml0aWFsR2VuZXJhdGlvblN0YXRlID0gZ2VuZXJhdGlvbkNvbmZpZy5pbml0aWFsR2VuZXJhdGlvblN0YXRlXG4gICAgdGhpcy5saWZlY3ljbGVTb2NrZXRQYXRoID0gZ2VuZXJhdGlvbkNvbmZpZy5saWZlY3ljbGVTb2NrZXRQYXRoXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkxpZmVjeWNsZVN0YXRlfSAqL1xuICAgIHRoaXMubGlmZWN5Y2xlU3RhdGUgPSBcInN0YXJ0aW5nXCJcbiAgICB0aGlzLl9hY3RpdmVPd25lcnNoaXBSZWFkeSA9IGZhbHNlXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2FjdGl2YXRpb25Qcm9taXNlID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX3JldGlyZW1lbnRQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHtTZXQ8SnNvblNvY2tldD59ICovXG4gICAgdGhpcy5jYW5kaWRhdGVSZWFkeVdvcmtlcnMgPSBuZXcgU2V0KClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIHt3b3JrZXI6IEpzb25Tb2NrZXQsIHRpbWVyOiBSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bWJlcn0+fSAqL1xuICAgIHRoaXMuZGlzY29ubmVjdGVkV29ya2VycyA9IG5ldyBNYXAoKVxuICAgIHRoaXMuX2xpZmVjeWNsZVJlcXVlc3RMZWFzZXMgPSAwXG4gICAgdGhpcy5fYWN0aXZlTm9uV29ya2VyUmVxdWVzdHMgPSAwXG4gICAgLyoqXG4gICAgICogUmVzb2x2ZXMgc3RvcCBvYnNlcnZhdGlvbi5cbiAgICAgKiBAdHlwZSB7KCkgPT4gdm9pZH1cbiAgICAgKi9cbiAgICB0aGlzLl9yZXNvbHZlU3RvcHBlZCA9ICgpID0+IHt9XG4gICAgdGhpcy5fc3RvcHBlZFByb21pc2UgPSBuZXcgUHJvbWlzZSgoLyoqIEB0eXBlIHsodmFsdWU6IHZvaWQpID0+IHZvaWR9ICovIHJlc29sdmUpID0+IHsgdGhpcy5fcmVzb2x2ZVN0b3BwZWQgPSByZXNvbHZlIH0pXG4gICAgdGhpcy5ob3N0ID0gaG9zdCB8fCBjb25maWcuaG9zdFxuICAgIHRoaXMucG9ydCA9IHR5cGVvZiBwb3J0ID09PSBcIm51bWJlclwiID8gcG9ydCA6IGNvbmZpZy5wb3J0XG4gICAgdGhpcy5kaXNwYXRjaFN0cmF0ZWd5ID0gY29uZmlnLmRpc3BhdGNoU3RyYXRlZ3lcbiAgICB0aGlzLnBvbGxJbnRlcnZhbE1zID0gY29uZmlnLnBvbGxJbnRlcnZhbE1zXG4gICAgdGhpcy5yZXRlbnRpb24gPSBjb25maWcucmV0ZW50aW9uXG4gICAgLy8gQSB3b3JrZXIgdGhhdCBzdG9wcyBzZW5kaW5nIGFueXRoaW5nIChoZWFydGJlYXQvcmVhZHkvcmVwb3J0KSBmb3IgdGhpc1xuICAgIC8vIGxvbmcgaXMgdHJlYXRlZCBhcyB3ZWRnZWQvZGVhZDogaXRzIGxlYXNlcyBhcmUgcmVsZWFzZWQgYW5kIGl0IGlzIGRyb3BwZWQuXG4gICAgdGhpcy53b3JrZXJTdGFsZVRpbWVvdXRNcyA9IHR5cGVvZiB3b3JrZXJTdGFsZVRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiAmJiB3b3JrZXJTdGFsZVRpbWVvdXRNcyA+PSAxID8gd29ya2VyU3RhbGVUaW1lb3V0TXMgOiBXT1JLRVJfU1RBTEVfVElNRU9VVF9NU1xuICAgIHRoaXMud29ya2VyTGl2ZW5lc3NTd2VlcE1zID0gdHlwZW9mIHdvcmtlckxpdmVuZXNzU3dlZXBNcyA9PT0gXCJudW1iZXJcIiAmJiB3b3JrZXJMaXZlbmVzc1N3ZWVwTXMgPj0gMSA/IHdvcmtlckxpdmVuZXNzU3dlZXBNcyA6IFdPUktFUl9MSVZFTkVTU19TV0VFUF9NU1xuICAgIHRoaXMud29ya2VyUmVjb25uZWN0R3JhY2VNcyA9IG5vcm1hbGl6ZVdvcmtlclJlY29ubmVjdEdyYWNlTXMod29ya2VyUmVjb25uZWN0R3JhY2VNcylcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vYWRhcHRlci5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuYWRhcHRlciA9IHVuZGVmaW5lZFxuICAgIHRoaXMubG9nZ2VyID0gbmV3IExvZ2dlcih0aGlzKVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7U2V0PEpzb25Tb2NrZXQ+fSAqL1xuICAgIHRoaXMud29ya2VycyA9IG5ldyBTZXQoKVxuICAgIC8qKiBAdHlwZSB7U2V0PEpzb25Tb2NrZXQ+fSAqL1xuICAgIHRoaXMuY29ubmVjdGlvbnMgPSBuZXcgU2V0KClcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1NldDxKc29uU29ja2V0Pn0gKi9cbiAgICB0aGlzLnJlYWR5V29ya2VycyA9IG5ldyBTZXQoKVxuICAgIC8qKlxuICAgICAqIEFjdGl2ZSBkdXJhYmxlIGhhbmRvZmZzIGtleWVkIGJ5IHRoZSBleGFjdCB3b3JrZXIgc29ja2V0IHRoYXQgcmVjZWl2ZWQgdGhlbS5cbiAgICAgKiBAdHlwZSB7TWFwPEpzb25Tb2NrZXQsIE1hcDxzdHJpbmcsIHN0cmluZz4+fSAqL1xuICAgIHRoaXMud29ya2VySGFuZG9mZnMgPSBuZXcgTWFwKClcbiAgICAvKipcbiAgICAgKiBFeGFjdCBjYWxsZXItZ2VuZXJhdGVkIGxlYXNlcyB3aG9zZSBjbGFpbSBvdXRjb21lIHdhcyBhbWJpZ3VvdXMgb3Igd2hvc2VcbiAgICAgKiBwcmUtZGlzcGF0Y2ggcmVsZWFzZSBoYXMgbm90IHlldCBiZWVuIGFja25vd2xlZGdlZC4gUmV0YWluZWQgdW50aWwgYVxuICAgICAqIGZlbmNlZCByZXR1cm4gc3VjY2VlZHMgKGluY2x1ZGluZyBhbiBleGFjdCBuby1vcCkuXG4gICAgICogQHR5cGUge01hcDxzdHJpbmcsIHN0cmluZz59ICovXG4gICAgdGhpcy5wZW5kaW5nSGFuZG9mZlJlY292ZXJpZXMgPSBuZXcgTWFwKClcbiAgICAvKipcbiAgICAgKiBIYW5kb2ZmLWFkb3B0aW9uIHF1ZXJpZXMgc3RhcnRlZCBieSB3b3JrZXIgaGVsbG8gbWVzc2FnZXMuIFNodXRkb3duIG11c3RcbiAgICAgKiB3YWl0IGZvciB0aGVzZSBiZWZvcmUgY2xvc2luZyB0aGUgY29uZmlndXJhdGlvbidzIGRhdGFiYXNlIHBvb2xzLlxuICAgICAqIEB0eXBlIHtTZXQ8UHJvbWlzZTx2b2lkPj59ICovXG4gICAgdGhpcy5pbmZsaWdodFdvcmtlckhhbmRvZmZBZG9wdGlvbnMgPSBuZXcgU2V0KClcbiAgICAvKipcbiAgICAgKiBXb3JrZXIgaWRzIHdob3NlIGhhbmRvZmZzIHdlcmUgc3VjY2Vzc2Z1bGx5IGFkb3B0ZWQgYnkgYSBzdGlsbC1saXZlXG4gICAgICogY29ubmVjdGlvbiBpbiB0aGlzIG1haW4gZ2VuZXJhdGlvbi5cbiAgICAgKiBAdHlwZSB7U2V0PHN0cmluZz59XG4gICAgICovXG4gICAgdGhpcy5yZWNvbm5lY3RlZFdvcmtlcklkcyA9IG5ldyBTZXQoKVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGFuZG9mZlNuYXBzaG90W119ICovXG4gICAgdGhpcy5zdGFydHVwSGFuZG9mZlNuYXBzaG90ID0gW11cbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD5bXX0gKi9cbiAgICB0aGlzLl9zdGFydHVwSGFuZG9mZkFkb3B0aW9uc0F0RGVhZGxpbmUgPSBbXVxuICAgIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmR3JhY2VFbGFwc2VkID0gZmFsc2VcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge25ldC5TZXJ2ZXIgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5zZXJ2ZXIgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX3BvbGxUaW1lciA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudW1iZXIgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fc2NoZWR1bGVkVGltZXIgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2Vycm9yUmV0cnlUaW1lciA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fb3JwaGFuVGltZXIgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldEludGVydmFsPiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl93b3JrZXJTdGFsZVRpbWVyID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bWJlciB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1UaW1lciA9IHVuZGVmaW5lZFxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1Qcm9taXNlID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtCYWNrZ3JvdW5kSm9ic1NjaGVkdWxlciB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLnNjaGVkdWxlciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2RyYWluaW5nID0gZmFsc2VcbiAgICB0aGlzLl9yZWRyYWluUXVldWVkID0gZmFsc2VcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fZHJhaW5Qcm9taXNlID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fc3RvcHBlZCA9IGZhbHNlXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuc3RvcFByb21pc2UgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUgeygoKSA9PiB2b2lkKSB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl91bnN1YnNjcmliZUJlYWNvbiA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7KCguLi5hcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IHZvaWQpIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2JlYWNvbkNvbm5lY3RIYW5kbGVyID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuLi9iZWFjb24vY2xpZW50LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuLi9iZWFjb24vaW4tcHJvY2Vzcy1jbGllbnQuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9iZWFjb25DbGllbnQgPSB1bmRlZmluZWRcbiAgICAvKiogQHR5cGUge0JhY2tncm91bmRKb2JzTGlmZWN5Y2xlQ29udHJvbFNlcnZlciB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLmxpZmVjeWNsZUNvbnRyb2xTZXJ2ZXIgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBDb21wYXRpYmlsaXR5IGFsaWFzIGZvciBpbnRlZ3JhdGlvbnMgdGhhdCBpbnNwZWN0IHRoZSBhY3RpdmUgbWFpbiBzdG9yZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vYWRhcHRlci5qc1wiKS5kZWZhdWx0fSAtIEFkYXB0ZXIgYWNxdWlyZWQgYnkgc3RhcnQuXG4gICAqL1xuICBnZXQgc3RvcmUoKSB7XG4gICAgaWYgKCF0aGlzLmFkYXB0ZXIpIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyBtYWluIGhhcyBub3QgYWNxdWlyZWQgaXRzIGFkYXB0ZXJcIilcblxuICAgIHJldHVybiB0aGlzLmFkYXB0ZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBQcmVzZXJ2ZXMgdGhlIGhpc3RvcmljYWwgc3ViY2xhc3Mgc2VhbSB3aGlsZSBrZWVwaW5nIG9uZSBhZGFwdGVyIHJlZmVyZW5jZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2FkYXB0ZXIuanNcIikuZGVmYXVsdH0gYWRhcHRlciAtIEFkYXB0ZXIgdG8gYXNzaWduLlxuICAgKi9cbiAgc2V0IHN0b3JlKGFkYXB0ZXIpIHtcbiAgICB0aGlzLmFkYXB0ZXIgPSBhZGFwdGVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdGFydC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBsaXN0ZW5pbmcuXG4gICAqL1xuICBhc3luYyBzdGFydCgpIHtcbiAgICB0aGlzLl9zdG9wcGVkID0gZmFsc2VcbiAgICB0aGlzLnN0b3BQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fYWN0aXZlT3duZXJzaGlwUmVhZHkgPSBmYWxzZVxuICAgIHRoaXMubGlmZWN5Y2xlU3RhdGUgPSBcInN0YXJ0aW5nXCJcbiAgICB0aGlzLl9zdG9wcGVkUHJvbWlzZSA9IG5ldyBQcm9taXNlKCgvKiogQHR5cGUgeyh2YWx1ZTogdm9pZCkgPT4gdm9pZH0gKi8gcmVzb2x2ZSkgPT4geyB0aGlzLl9yZXNvbHZlU3RvcHBlZCA9IHJlc29sdmUgfSlcbiAgICB0aGlzLnJlY29ubmVjdGVkV29ya2VySWRzLmNsZWFyKClcbiAgICB0aGlzLnN0YXJ0dXBIYW5kb2ZmU25hcHNob3QgPSBbXVxuICAgIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmQWRvcHRpb25zQXREZWFkbGluZSA9IFtdXG4gICAgdGhpcy5fc3RhcnR1cEhhbmRvZmZHcmFjZUVsYXBzZWQgPSBmYWxzZVxuICAgIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVByb21pc2UgPSB1bmRlZmluZWRcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24uc2V0Q3VycmVudCgpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmluaXRpYWxpemUoe3R5cGU6IFwiYmFja2dyb3VuZC1qb2JzLW1haW5cIn0pXG4gICAgICBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uY29ubmVjdEJlYWNvbih7cGVlclR5cGU6IFwiYmFja2dyb3VuZC1qb2JzLW1haW5cIn0pXG5cbiAgICAgIGlmICghdGhpcy5hZGFwdGVyKSB7XG4gICAgICAgIHRoaXMuYWRhcHRlciA9IGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5hY3F1aXJlUmVhZHlCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoKVxuICAgICAgfVxuICAgICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkICYmICF0aGlzLmFkYXB0ZXIuc3VwcG9ydHNSZWxlYXNlU2NvcGVkR2VuZXJhdGlvbnMoKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJUaGUgY29uZmlndXJlZCBiYWNrZ3JvdW5kIGpvYnMgYWRhcHRlciBkb2VzIG5vdCBzdXBwb3J0IHJlbGVhc2Utc2NvcGVkIGdlbmVyYXRpb25zXCIpXG4gICAgICB9XG4gICAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQgJiYgIXRoaXMuYWRhcHRlci5zdXBwb3J0c093bmVkRW5xdWV1ZUZyb21IYW5kb2ZmKCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVGhlIGNvbmZpZ3VyZWQgYmFja2dyb3VuZCBqb2JzIGFkYXB0ZXIgZG9lcyBub3Qgc3VwcG9ydCBhdG9taWMgb3duZWQtaGFuZG9mZiBlbnF1ZXVlXCIpXG4gICAgICB9XG5cbiAgICAgIGlmICghdGhpcy5nZW5lcmF0aW9uSWQgfHwgdGhpcy5pbml0aWFsR2VuZXJhdGlvblN0YXRlICE9PSBcImNhbmRpZGF0ZVwiKSB7XG4gICAgICAgIHRoaXMuc3RhcnR1cEhhbmRvZmZTbmFwc2hvdCA9IGF3YWl0IHRoaXMuX2dlbmVyYXRpb25Pd25lZEhhbmRvZmZTbmFwc2hvdCgpXG4gICAgICB9XG4gICAgICBjb25zdCBzZXJ2ZXIgPSBuZXQuY3JlYXRlU2VydmVyKChzb2NrZXQpID0+IHRoaXMuX2hhbmRsZUNvbm5lY3Rpb24oc29ja2V0KSlcbiAgICAgIHRoaXMuc2VydmVyID0gc2VydmVyXG5cbiAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgc2VydmVyLm9uY2UoXCJlcnJvclwiLCByZWplY3QpXG4gICAgICAgIHNlcnZlci5saXN0ZW4odGhpcy5wb3J0LCB0aGlzLmhvc3QsICgpID0+IHJlc29sdmUodW5kZWZpbmVkKSlcbiAgICAgIH0pXG5cbiAgICAgIGNvbnN0IGFkZHJlc3MgPSBzZXJ2ZXIuYWRkcmVzcygpXG4gICAgICBpZiAoYWRkcmVzcyAmJiB0eXBlb2YgYWRkcmVzcyA9PT0gXCJvYmplY3RcIikge1xuICAgICAgICB0aGlzLnBvcnQgPSBhZGRyZXNzLnBvcnRcbiAgICAgIH1cblxuICAgICAgdGhpcy5saWZlY3ljbGVTdGF0ZSA9IHRoaXMuZ2VuZXJhdGlvbklkID8gdGhpcy5pbml0aWFsR2VuZXJhdGlvblN0YXRlIDogXCJhY3RpdmVcIlxuXG4gICAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQgJiYgdGhpcy5saWZlY3ljbGVTb2NrZXRQYXRoKSB7XG4gICAgICAgIHRoaXMubGlmZWN5Y2xlQ29udHJvbFNlcnZlciA9IG5ldyBCYWNrZ3JvdW5kSm9ic0xpZmVjeWNsZUNvbnRyb2xTZXJ2ZXIoe1xuICAgICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbixcbiAgICAgICAgICBnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkLFxuICAgICAgICAgIG1haW46IHRoaXMsXG4gICAgICAgICAgc29ja2V0UGF0aDogdGhpcy5saWZlY3ljbGVTb2NrZXRQYXRoXG4gICAgICAgIH0pXG4gICAgICAgIGF3YWl0IHRoaXMubGlmZWN5Y2xlQ29udHJvbFNlcnZlci5zdGFydCgpXG4gICAgICB9XG5cbiAgICAgIHRoaXMuX3dvcmtlclN0YWxlVGltZXIgPSBzZXRJbnRlcnZhbCgoKSA9PiB7XG4gICAgICAgIHZvaWQgdGhpcy5fc3dlZXBTdGFsZVdvcmtlcnMoKVxuICAgICAgfSwgdGhpcy53b3JrZXJMaXZlbmVzc1N3ZWVwTXMpXG5cbiAgICAgIGlmICh0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcImFjdGl2ZVwiKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3N0YXJ0QWN0aXZlT3duZXJzaGlwKFwiYWN0aXZlXCIpXG4gICAgICB9IGVsc2UgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwicmV0aXJlZFwiKSB7XG4gICAgICAgIHRoaXMuX3N0YXJ0R2VuZXJhdGlvblJlY292ZXJ5T3duZXJzaGlwKClcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgbGV0IGNsZWFudXBFcnJvclxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLnN0b3AoKVxuICAgICAgfSBjYXRjaCAoY2F1Z2h0Q2xlYW51cEVycm9yKSB7XG4gICAgICAgIGNsZWFudXBFcnJvciA9IGNhdWdodENsZWFudXBFcnJvclxuICAgICAgfVxuXG4gICAgICBpZiAoY2xlYW51cEVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihcbiAgICAgICAgICBbZXJyb3IsIGNsZWFudXBFcnJvcl0sXG4gICAgICAgICAgXCJCYWNrZ3JvdW5kIGpvYnMgbWFpbiBzdGFydHVwIGFuZCBjbGVhbnVwIGZhaWxlZFwiLFxuICAgICAgICAgIHtjYXVzZTogZXJyb3J9XG4gICAgICAgIClcbiAgICAgIH1cblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdG9wLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNsb3NlZC5cbiAgICovXG4gIHN0b3AoKSB7XG4gICAgaWYgKCF0aGlzLnN0b3BQcm9taXNlKSB0aGlzLnN0b3BQcm9taXNlID0gdGhpcy5fc3RvcCgpXG5cbiAgICByZXR1cm4gdGhpcy5zdG9wUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdGhlIG1haW4tcHJvY2VzcyBzaHV0ZG93biBsaWZlY3ljbGUgb25jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjbG9zZWQuXG4gICAqL1xuICBhc3luYyBfc3RvcCgpIHtcbiAgICB0aGlzLl9zdG9wcGVkID0gdHJ1ZVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHNodXRkb3duTGlmZWN5Y2xlKHtcbiAgICAgICAgb25TdG9wcGVkOiB0aGlzLm9uU3RvcHBlZCxcbiAgICAgICAgc2h1dGRvd246IGFzeW5jICgpID0+IHtcbiAgICAgICAgICB0aGlzLl9jbG9zZVdvcmtlcnMoKVxuICAgICAgICAgIHRoaXMuX2NsZWFyVGltZXJzKClcbiAgICAgICAgICB0aGlzLl9kaXNjb25uZWN0QmVhY29uSGFuZGxlcnMoKVxuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnNjaGVkdWxlcj8uc3RvcCgpXG4gICAgICAgICAgICBpZiAodGhpcy5fZHJhaW5Qcm9taXNlKSBhd2FpdCB0aGlzLl9kcmFpblByb21pc2VcbiAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5fZHJhaW5Xb3JrZXJIYW5kb2ZmQWRvcHRpb25zKClcbiAgICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5fZHJhaW5TdGFydHVwSGFuZG9mZlJlY2xhaW0oKVxuICAgICAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuX3N0b3BCZWFjb25BbmRTZXJ2ZXIoKVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLmFkYXB0ZXIgPSB1bmRlZmluZWRcbiAgICAgIHRoaXMubGlmZWN5Y2xlU3RhdGUgPSBcInN0b3BwZWRcIlxuICAgICAgdGhpcy5fcmVzb2x2ZVN0b3BwZWQoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsb3NlIHdvcmtlcnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAqL1xuICBfY2xvc2VXb3JrZXJzKCkge1xuICAgIGZvciAoY29uc3QgY29ubmVjdGlvbiBvZiB0aGlzLmNvbm5lY3Rpb25zKSB7XG4gICAgICBjb25uZWN0aW9uLmNsb3NlKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGVhciB0aW1lcnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAqL1xuICBfY2xlYXJUaW1lcnMoKSB7XG4gICAgaWYgKHRoaXMuX3BvbGxUaW1lcikgY2xlYXJJbnRlcnZhbCh0aGlzLl9wb2xsVGltZXIpXG4gICAgaWYgKHRoaXMuX3NjaGVkdWxlZFRpbWVyKSB0aGlzLmNsb2NrLmNsZWFyVGltZW91dCh0aGlzLl9zY2hlZHVsZWRUaW1lcilcbiAgICBpZiAodGhpcy5fZXJyb3JSZXRyeVRpbWVyKSBjbGVhclRpbWVvdXQodGhpcy5fZXJyb3JSZXRyeVRpbWVyKVxuICAgIGlmICh0aGlzLl9vcnBoYW5UaW1lcikgY2xlYXJJbnRlcnZhbCh0aGlzLl9vcnBoYW5UaW1lcilcbiAgICBpZiAodGhpcy5fd29ya2VyU3RhbGVUaW1lcikgY2xlYXJJbnRlcnZhbCh0aGlzLl93b3JrZXJTdGFsZVRpbWVyKVxuICAgIGlmICh0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1UaW1lcikgdGhpcy5jbG9jay5jbGVhclRpbWVvdXQodGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltVGltZXIpXG4gICAgZm9yIChjb25zdCB7dGltZXJ9IG9mIHRoaXMuZGlzY29ubmVjdGVkV29ya2Vycy52YWx1ZXMoKSkgdGhpcy5jbG9jay5jbGVhclRpbWVvdXQodGltZXIpXG4gICAgdGhpcy5kaXNjb25uZWN0ZWRXb3JrZXJzLmNsZWFyKClcbiAgICB0aGlzLl9wb2xsVGltZXIgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9zY2hlZHVsZWRUaW1lciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2Vycm9yUmV0cnlUaW1lciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX29ycGhhblRpbWVyID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fd29ya2VyU3RhbGVUaW1lciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVRpbWVyID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkaXNjb25uZWN0IGJlYWNvbiBoYW5kbGVycy5cbiAgICogQHJldHVybnMge3ZvaWR9ICovXG4gIF9kaXNjb25uZWN0QmVhY29uSGFuZGxlcnMoKSB7XG4gICAgaWYgKHRoaXMuX3Vuc3Vic2NyaWJlQmVhY29uKSB7XG4gICAgICB0aGlzLl91bnN1YnNjcmliZUJlYWNvbigpXG4gICAgICB0aGlzLl91bnN1YnNjcmliZUJlYWNvbiA9IHVuZGVmaW5lZFxuICAgIH1cblxuICAgIGlmICh0aGlzLl9iZWFjb25DbGllbnQgJiYgdGhpcy5fYmVhY29uQ29ubmVjdEhhbmRsZXIpIHtcbiAgICAgIHRoaXMuX2JlYWNvbkNsaWVudC5vZmYoXCJjb25uZWN0XCIsIHRoaXMuX2JlYWNvbkNvbm5lY3RIYW5kbGVyKVxuICAgIH1cbiAgICB0aGlzLl9iZWFjb25Db25uZWN0SGFuZGxlciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2JlYWNvbkNsaWVudCA9IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RvcCBiZWFjb24gYW5kIHNlcnZlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59ICovXG4gIGFzeW5jIF9zdG9wQmVhY29uQW5kU2VydmVyKCkge1xuICAgIGF3YWl0IHJ1blNodXRkb3duU3RlcHMoe1xuICAgICAgbWVzc2FnZTogXCJCYWNrZ3JvdW5kIGpvYnMgbWFpbiBhcHBsaWNhdGlvbiBhbmQgZnJhbWV3b3JrIHNodXRkb3duIGZhaWxlZFwiLFxuICAgICAgc3RlcHM6IFtcbiAgICAgICAgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmxpZmVjeWNsZUNvbnRyb2xTZXJ2ZXI/LmNsb3NlKClcbiAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgdGhpcy5saWZlY3ljbGVDb250cm9sU2VydmVyID0gdW5kZWZpbmVkXG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICAuLi4odGhpcy5jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3BcbiAgICAgICAgICA/IFthc3luYyAoKSA9PiBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uc2h1dGRvd24oKV1cbiAgICAgICAgICA6IFtdKSxcbiAgICAgICAgYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmRpc2Nvbm5lY3RCZWFjb24oKSxcbiAgICAgICAgYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5fY2xvc2VTZXJ2ZXIoKSxcbiAgICAgICAgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGlmICh0aGlzLmNsb3NlRGF0YWJhc2VDb25uZWN0aW9uc09uU3RvcCkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmNsb3NlRGF0YWJhc2VDb25uZWN0aW9ucygpXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5jbG9zZUJhY2tncm91bmRKb2JzQWRhcHRlcigpXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICBdXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsb3NlIHNlcnZlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59ICovXG4gIGFzeW5jIF9jbG9zZVNlcnZlcigpIHtcbiAgICBpZiAoIXRoaXMuc2VydmVyKSByZXR1cm5cblxuICAgIGNvbnN0IHtzZXJ2ZXJ9ID0gdGhpc1xuICAgIHRoaXMuc2VydmVyID0gdW5kZWZpbmVkXG4gICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHNlcnZlci5jbG9zZSgoKSA9PiByZXNvbHZlKHVuZGVmaW5lZCkpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHBvcnQuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gQm91bmQgcG9ydC5cbiAgICovXG4gIGdldFBvcnQoKSB7XG4gICAgcmV0dXJuIHRoaXMucG9ydFxuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgdGhlIGxpZmVjeWNsZSBzdGF0ZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uTGlmZWN5Y2xlU3RhdGV9IC0gQ3VycmVudCBsaWZlY3ljbGUgc3RhdGUuXG4gICAqL1xuICBnZXRMaWZlY3ljbGVTdGF0ZSgpIHsgcmV0dXJuIHRoaXMubGlmZWN5Y2xlU3RhdGUgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGEgcHJvbWlzZSB0aGF0IHNldHRsZXMgb25seSBhZnRlciB0aGUgbWFpbiBoYXMgZnVsbHkgc3RvcHBlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gU3RvcCBjb21wbGV0aW9uLlxuICAgKi9cbiAgYXN5bmMgd2FpdFVudGlsU3RvcHBlZCgpIHsgYXdhaXQgdGhpcy5fc3RvcHBlZFByb21pc2UgfVxuXG4gIC8qKlxuICAgKiBTbmFwc2hvdHMgb25seSBleGFjdCBkdXJhYmxlIG93bmVycyBmcm9tIHRoaXMgcmVsZWFzZSBnZW5lcmF0aW9uLlxuICAgKiBMZWdhY3kgbW9kZSBpbnRlbnRpb25hbGx5IHJldGFpbnMgaXRzIGhpc3RvcmljYWwgZ2xvYmFsIHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JIYW5kb2ZmU25hcHNob3RbXT59IC0gT3duZWQgc25hcHNob3QuXG4gICAqL1xuICBhc3luYyBfZ2VuZXJhdGlvbk93bmVkSGFuZG9mZlNuYXBzaG90KCkge1xuICAgIGNvbnN0IGhhbmRvZmZzID0gYXdhaXQgdGhpcy5zdG9yZS5zbmFwc2hvdEhhbmRlZE9mZkpvYnMoKVxuXG4gICAgaWYgKCF0aGlzLmdlbmVyYXRpb25JZCkgcmV0dXJuIGhhbmRvZmZzXG4gICAgY29uc3QgZ2VuZXJhdGlvbklkID0gdGhpcy5nZW5lcmF0aW9uSWRcblxuICAgIHJldHVybiBoYW5kb2Zmcy5maWx0ZXIoKHt3b3JrZXJJZH0pID0+IHdvcmtlcklkQmVsb25nc1RvR2VuZXJhdGlvbih7Z2VuZXJhdGlvbklkLCB3b3JrZXJJZH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIEFjcXVpcmVzIHNjaGVkdWxpbmcgYW5kIGRpc3BhdGNoIG93bmVyc2hpcCBmb3IgYW4gYWN0aXZlIGdlbmVyYXRpb24uXG4gICAqIEBwYXJhbSB7XCJhY3RpdmVcIiB8IFwiY2FuZGlkYXRlXCJ9IGV4cGVjdGVkTGlmZWN5Y2xlU3RhdGUgLSBTdGF0ZSB0aGF0IHN0aWxsIG93bnMgYWN0aXZhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBhY3RpdmUgb3duZXJzaGlwIHdhcyBlc3RhYmxpc2hlZC5cbiAgICovXG4gIGFzeW5jIF9zdGFydEFjdGl2ZU93bmVyc2hpcChleHBlY3RlZExpZmVjeWNsZVN0YXRlKSB7XG4gICAgYXdhaXQgdGhpcy5zdG9yZS5yZWNvbmNpbGVRdWV1ZUNvbmN1cnJlbmN5KClcbiAgICBpZiAodGhpcy5saWZlY3ljbGVTdGF0ZSAhPT0gZXhwZWN0ZWRMaWZlY3ljbGVTdGF0ZSkgcmV0dXJuIGZhbHNlXG4gICAgdGhpcy5fc2V0dXBEaXNwYXRjaFRyaWdnZXJzKClcbiAgICB0aGlzLl9zdGFydE9ycGhhblN3ZWVwKClcbiAgICBhd2FpdCB0aGlzLl9zdGFydFNjaGVkdWxlcigpXG4gICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgIT09IGV4cGVjdGVkTGlmZWN5Y2xlU3RhdGUpIHtcbiAgICAgIGlmICh0aGlzLnNjaGVkdWxlcikgYXdhaXQgdGhpcy5zY2hlZHVsZXIuc3RvcCgpXG4gICAgICB0aGlzLnNjaGVkdWxlciA9IHVuZGVmaW5lZFxuICAgICAgdGhpcy5fY2xlYXJEaXNwYXRjaFRpbWVycygpXG4gICAgICB0aGlzLl9kaXNjb25uZWN0QmVhY29uSGFuZGxlcnMoKVxuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuICAgIHRoaXMuX2FjdGl2ZU93bmVyc2hpcFJlYWR5ID0gdHJ1ZVxuICAgIHRoaXMuX2NyZWRpdFJlYWR5V29ya2VycygpXG4gICAgYXdhaXQgdGhpcy5fZHJhaW4oKVxuICAgIGlmICh0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBleHBlY3RlZExpZmVjeWNsZVN0YXRlKSB0aGlzLl9zZXR1cFN0YXJ0dXBIYW5kb2ZmUmVjbGFpbSgpXG4gICAgcmV0dXJuIHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IGV4cGVjdGVkTGlmZWN5Y2xlU3RhdGVcbiAgfVxuXG4gIC8qKiBTdGFydHMgZXhhY3QgcmVjb3ZlcnkgZHV0aWVzIHdpdGhvdXQgYWNxdWlyaW5nIGdsb2JhbCBkaXNwYXRjaCBvd25lcnNoaXAuICovXG4gIF9zdGFydEdlbmVyYXRpb25SZWNvdmVyeU93bmVyc2hpcCgpIHtcbiAgICB0aGlzLl9zZXR1cFN0YXJ0dXBIYW5kb2ZmUmVjbGFpbSgpXG4gICAgdGhpcy5fc3RhcnRPcnBoYW5Td2VlcCgpXG4gICAgdGhpcy5fbWF5YmVTdG9wUmV0aXJlZCgpXG4gIH1cblxuICAvKiogU3RhcnRzIHRoZSBnZW5lcmF0aW9uLWZlbmNlZCBvcnBoYW4gc3dlZXAuICovXG4gIF9zdGFydE9ycGhhblN3ZWVwKCkge1xuICAgIGlmICh0aGlzLl9vcnBoYW5UaW1lcikgcmV0dXJuXG5cbiAgICB0aGlzLl9vcnBoYW5UaW1lciA9IHNldEludGVydmFsKCgpID0+IHsgdm9pZCB0aGlzLl9zd2VlcE9ycGhhbnMoKSB9LCA2MDAwMClcbiAgfVxuXG4gIC8qKlxuICAgKiBTdGFydHMgc2NoZWR1bGUgb3duZXJzaGlwIGV4YWN0bHkgb25jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgc2NoZWR1bGVzIGFyZSBsb2FkZWQuXG4gICAqL1xuICBhc3luYyBfc3RhcnRTY2hlZHVsZXIoKSB7XG4gICAgaWYgKHRoaXMuc2NoZWR1bGVyKSByZXR1cm5cblxuICAgIHRoaXMuc2NoZWR1bGVyID0gbmV3IEJhY2tncm91bmRKb2JzU2NoZWR1bGVyKHtcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbixcbiAgICAgIGVucXVldWVKb2I6IGFzeW5jICh7YXJncywgam9iQ2xhc3MsIG9wdGlvbnN9KSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMuc3RvcmUuZW5xdWV1ZSh7XG4gICAgICAgICAgam9iTmFtZTogam9iQ2xhc3Muam9iTmFtZSgpLFxuICAgICAgICAgIGFyZ3MsXG4gICAgICAgICAgb3B0aW9uczogam9iQ2xhc3MuX3dpdGhKb2JDb250ZXh0KHtqb2JBcmdzOiBhcmdzLCBqb2JPcHRpb25zOiBvcHRpb25zfSlcbiAgICAgICAgfSlcbiAgICAgICAgdGhpcy5fbm90aWZ5RW5xdWV1ZWQoKVxuICAgICAgICB2b2lkIHRoaXMuX2RyYWluKClcbiAgICAgIH1cbiAgICB9KVxuICAgIGF3YWl0IHRoaXMuc2NoZWR1bGVyLnN0YXJ0KClcblxuICAgIGNvbnN0IHJldGVudGlvblNjaGVkdWxlID0gUHJ1bmVUZXJtaW5hbEJhY2tncm91bmRKb2JzSm9iLnNjaGVkdWxlQ29uZmlndXJhdGlvbih0aGlzLnJldGVudGlvbilcblxuICAgIGlmIChyZXRlbnRpb25TY2hlZHVsZSkge1xuICAgICAgdGhpcy5zY2hlZHVsZXIuc2NoZWR1bGVKb2Ioe2pvYkNvbmZpZ3VyYXRpb246IHJldGVudGlvblNjaGVkdWxlLCBqb2JLZXk6IFwidmVsb2Npb3VzUHJ1bmVUZXJtaW5hbEJhY2tncm91bmRKb2JzXCJ9KVxuICAgIH1cbiAgfVxuXG4gIC8qKiBDcmVkaXRzIHJlYWRpbmVzcyBhZHZlcnRpc2VtZW50cyByZWNvcmRlZCB3aGlsZSBkaXNwYXRjaCB3YXMgZmVuY2VkLiAqL1xuICBfY3JlZGl0UmVhZHlXb3JrZXJzKCkge1xuICAgIGZvciAoY29uc3Qgd29ya2VyIG9mIHRoaXMuY2FuZGlkYXRlUmVhZHlXb3JrZXJzKSB7XG4gICAgICBpZiAodGhpcy53b3JrZXJzLmhhcyh3b3JrZXIpICYmICF3b3JrZXIuaXNEcmFpbmluZyAmJiB3b3JrZXIuc3VwcG9ydHNIYW5kb2ZmSWRSZXBvcnRpbmcpIHtcbiAgICAgICAgdGhpcy5yZWFkeVdvcmtlcnMuYWRkKHdvcmtlcilcbiAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5jYW5kaWRhdGVSZWFkeVdvcmtlcnMuY2xlYXIoKVxuICB9XG5cbiAgLyoqXG4gICAqIEFjdGl2YXRlcyBhIGNhbmRpZGF0ZSBhZnRlciBpdHMgc3VwZXJ2aXNvciBoYXMgcmV0aXJlZCB0aGUgb2xkIGdlbmVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHNjaGVkdWxpbmcgYW5kIGRpc3BhdGNoIGFyZSBhY3RpdmUuXG4gICAqL1xuICBhY3RpdmF0ZSgpIHtcbiAgICBpZiAoIXRoaXMuZ2VuZXJhdGlvbklkKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgZ2VuZXJhdGlvbiBhY3RpdmF0aW9uIHJlcXVpcmVzIGdlbmVyYXRpb24gbW9kZVwiKVxuICAgIGlmICh0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcImFjdGl2ZVwiKSByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKClcbiAgICBpZiAodGhpcy5saWZlY3ljbGVTdGF0ZSAhPT0gXCJjYW5kaWRhdGVcIikgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgYWN0aXZhdGUgYmFja2dyb3VuZCBqb2JzIGdlbmVyYXRpb24gZnJvbSAke3RoaXMubGlmZWN5Y2xlU3RhdGV9YClcbiAgICBpZiAoIXRoaXMuX2FjdGl2YXRpb25Qcm9taXNlKSB0aGlzLl9hY3RpdmF0aW9uUHJvbWlzZSA9IHRoaXMuX2FjdGl2YXRlKClcblxuICAgIHJldHVybiB0aGlzLl9hY3RpdmF0aW9uUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWN0aXZhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gQWN0aXZhdGlvbiBjb21wbGV0aW9uLlxuICAgKi9cbiAgYXN5bmMgX2FjdGl2YXRlKCkge1xuICAgIHRoaXMubG9nZ2VyLmluZm8oKCkgPT4gW1wiQmFja2dyb3VuZCBqb2JzIGdlbmVyYXRpb24gYWN0aXZhdGlvbiBzdGFydGluZ1wiLCB7Z2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZH1dKVxuICAgIGNvbnN0IG93bmVyc2hpcFN0YXJ0ZWQgPSBhd2FpdCB0aGlzLl9zdGFydEFjdGl2ZU93bmVyc2hpcChcImNhbmRpZGF0ZVwiKVxuICAgIGlmICghb3duZXJzaGlwU3RhcnRlZCB8fCB0aGlzLmxpZmVjeWNsZVN0YXRlICE9PSBcImNhbmRpZGF0ZVwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgZ2VuZXJhdGlvbiByZXRpcmVtZW50IHN0YXJ0ZWQgYmVmb3JlIGFjdGl2YXRpb24gYWNxdWlyZWQgb3duZXJzaGlwXCIpXG4gICAgfVxuICAgIHRoaXMubGlmZWN5Y2xlU3RhdGUgPSBcImFjdGl2ZVwiXG4gICAgdGhpcy5fY3JlZGl0UmVhZHlXb3JrZXJzKClcbiAgICB0aGlzLmxvZ2dlci5pbmZvKCgpID0+IFtcIkJhY2tncm91bmQgam9icyBnZW5lcmF0aW9uIGFjdGl2YXRpb24gYWNrbm93bGVkZ2VkXCIsIHtnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkfV0pXG4gICAgdm9pZCB0aGlzLl9kcmFpbigpLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiQmFja2dyb3VuZCBqb2JzIGdlbmVyYXRpb24gcG9zdC1hY3RpdmF0aW9uIGRyYWluIGZhaWxlZFwiLCB7ZXJyb3IsIGdlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWR9XSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEVzdGFibGlzaGVzIHRoZSBzeW5jaHJvbm91cyByZXRpcmVtZW50IGZlbmNlIGFuZCB0aGVuIGRyYWlucyBvd25lcnNoaXAgc2V0dXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSByZXRpcmVtZW50IGZlbmNlIGlzIGR1cmFibGUgaW4gbWVtb3J5LlxuICAgKi9cbiAgcmV0aXJlKCkge1xuICAgIGlmICghdGhpcy5nZW5lcmF0aW9uSWQpIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyBnZW5lcmF0aW9uIHJldGlyZW1lbnQgcmVxdWlyZXMgZ2VuZXJhdGlvbiBtb2RlXCIpXG4gICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwicmV0aXJpbmdcIiB8fCB0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcInJldGlyZWRcIikgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpXG4gICAgY29uc3QgYWN0aXZhdGlvbkluUHJvZ3Jlc3MgPSB0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcImNhbmRpZGF0ZVwiICYmIEJvb2xlYW4odGhpcy5fYWN0aXZhdGlvblByb21pc2UpXG4gICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgIT09IFwiYWN0aXZlXCIgJiYgIWFjdGl2YXRpb25JblByb2dyZXNzKSB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCByZXRpcmUgYmFja2dyb3VuZCBqb2JzIGdlbmVyYXRpb24gZnJvbSAke3RoaXMubGlmZWN5Y2xlU3RhdGV9YClcblxuICAgIHRoaXMubGlmZWN5Y2xlU3RhdGUgPSBcInJldGlyaW5nXCJcbiAgICB0aGlzLl9hY3RpdmVPd25lcnNoaXBSZWFkeSA9IGZhbHNlXG4gICAgdGhpcy5yZWFkeVdvcmtlcnMuY2xlYXIoKVxuICAgIHRoaXMuY2FuZGlkYXRlUmVhZHlXb3JrZXJzLmNsZWFyKClcbiAgICB0aGlzLl9jbGVhckRpc3BhdGNoVGltZXJzKClcbiAgICB0aGlzLl9kaXNjb25uZWN0QmVhY29uSGFuZGxlcnMoKVxuICAgIHRoaXMuX3JldGlyZW1lbnRQcm9taXNlID0gdGhpcy5fcmV0aXJlKClcbiAgICB2b2lkIHRoaXMuX3JldGlyZW1lbnRQcm9taXNlLmNhdGNoKChlcnJvcikgPT4gdGhpcy5fcmVwb3J0Q29ubmVjdGlvbkhhbmRsZXJFcnJvcihlcnJvcikpXG5cbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJldGlyZW1lbnQgYWZ0ZXIgaXRzIHN5bmNocm9ub3VzIGZlbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXRpcmVtZW50IGZlbmNlIGNvbXBsZXRpb24uXG4gICAqL1xuICBhc3luYyBfcmV0aXJlKCkge1xuICAgIGlmICh0aGlzLl9hY3RpdmF0aW9uUHJvbWlzZSkgYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKFt0aGlzLl9hY3RpdmF0aW9uUHJvbWlzZV0pXG4gICAgaWYgKHRoaXMuc2NoZWR1bGVyKSBhd2FpdCB0aGlzLnNjaGVkdWxlci5zdG9wKClcbiAgICB0aGlzLnNjaGVkdWxlciA9IHVuZGVmaW5lZFxuICAgIGlmICh0aGlzLl9kcmFpblByb21pc2UpIGF3YWl0IHRoaXMuX2RyYWluUHJvbWlzZVxuICAgIGlmICh0aGlzLl9zdG9wcGVkKSByZXR1cm5cblxuICAgIGZvciAoY29uc3Qgd29ya2VyIG9mIHRoaXMud29ya2Vycykge1xuICAgICAgd29ya2VyLmlzRHJhaW5pbmcgPSB0cnVlXG4gICAgICB3b3JrZXIuc2VuZCh7dHlwZTogXCJyZXRpcmVcIiwgZ2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZH0pXG4gICAgfVxuXG4gICAgdGhpcy5saWZlY3ljbGVTdGF0ZSA9IFwicmV0aXJlZFwiXG4gICAgdGhpcy5fc3RhcnRHZW5lcmF0aW9uUmVjb3ZlcnlPd25lcnNoaXAoKVxuICB9XG5cbiAgLyoqIENsZWFycyB0aW1lcnMgdGhhdCBjYW4gaW5pdGlhdGUgbmV3IGdsb2JhbCBkaXNwYXRjaCBvciBzY2hlZHVsZSB3b3JrLiAqL1xuICBfY2xlYXJEaXNwYXRjaFRpbWVycygpIHtcbiAgICBpZiAodGhpcy5fcG9sbFRpbWVyKSBjbGVhckludGVydmFsKHRoaXMuX3BvbGxUaW1lcilcbiAgICBpZiAodGhpcy5fc2NoZWR1bGVkVGltZXIpIHRoaXMuY2xvY2suY2xlYXJUaW1lb3V0KHRoaXMuX3NjaGVkdWxlZFRpbWVyKVxuICAgIGlmICh0aGlzLl9lcnJvclJldHJ5VGltZXIpIGNsZWFyVGltZW91dCh0aGlzLl9lcnJvclJldHJ5VGltZXIpXG4gICAgdGhpcy5fcG9sbFRpbWVyID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fc2NoZWR1bGVkVGltZXIgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9lcnJvclJldHJ5VGltZXIgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKiBIb2xkcyB0aGUgbWFpbiBvcGVuIHVudGlsIGEgbGlmZWN5Y2xlIHJlc3BvbnNlIGhhcyBmbHVzaGVkLiAqL1xuICBhY3F1aXJlTGlmZWN5Y2xlUmVxdWVzdExlYXNlKCkgeyB0aGlzLl9saWZlY3ljbGVSZXF1ZXN0TGVhc2VzICs9IDEgfVxuXG4gIC8qKiBSZWxlYXNlcyBvbmUgbGlmZWN5Y2xlLXJlc3BvbnNlIGxlYXNlIGFmdGVyIGl0cyBzb2NrZXQgd3JpdGUgY2FsbGJhY2suICovXG4gIHJlbGVhc2VMaWZlY3ljbGVSZXF1ZXN0TGVhc2UoKSB7XG4gICAgaWYgKHRoaXMuX2xpZmVjeWNsZVJlcXVlc3RMZWFzZXMgPCAxKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBiYWNrZ3JvdW5kIGpvYnMgbGlmZWN5Y2xlIHJlcXVlc3QgbGVhc2UgdG8gcmVsZWFzZVwiKVxuICAgIHRoaXMuX2xpZmVjeWNsZVJlcXVlc3RMZWFzZXMgLT0gMVxuICAgIHRoaXMuX21heWJlU3RvcFJldGlyZWQoKVxuICB9XG5cbiAgLyoqIFN0b3BzIGEgcmV0aXJlZCBnZW5lcmF0aW9uIG9ubHkgYWZ0ZXIgaXRzIGV4YWN0IG93bmVyc2hpcCBoYXMgZHJhaW5lZC4gKi9cbiAgX21heWJlU3RvcFJldGlyZWQoKSB7XG4gICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgIT09IFwicmV0aXJlZFwiIHx8IHRoaXMuX3N0b3BwZWQgfHwgdGhpcy5zdG9wUHJvbWlzZSkgcmV0dXJuXG4gICAgaWYgKHRoaXMuX2xpZmVjeWNsZVJlcXVlc3RMZWFzZXMgPiAwIHx8IHRoaXMuX2FjdGl2ZU5vbldvcmtlclJlcXVlc3RzID4gMCB8fCB0aGlzLndvcmtlcnMuc2l6ZSA+IDAgfHwgdGhpcy5kaXNjb25uZWN0ZWRXb3JrZXJzLnNpemUgPiAwKSByZXR1cm5cbiAgICBpZiAodGhpcy5pbmZsaWdodFdvcmtlckhhbmRvZmZBZG9wdGlvbnMuc2l6ZSA+IDAgfHwgdGhpcy5wZW5kaW5nSGFuZG9mZlJlY292ZXJpZXMuc2l6ZSA+IDApIHJldHVyblxuICAgIGlmICh0aGlzLl9kcmFpblByb21pc2UgfHwgdGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltUHJvbWlzZSB8fCB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1UaW1lcikgcmV0dXJuXG4gICAgaWYgKHRoaXMuc3RhcnR1cEhhbmRvZmZTbmFwc2hvdC5sZW5ndGggPiAwKSByZXR1cm5cblxuICAgIGZvciAoY29uc3QgaGFuZG9mZnMgb2YgdGhpcy53b3JrZXJIYW5kb2Zmcy52YWx1ZXMoKSkge1xuICAgICAgaWYgKGhhbmRvZmZzLnNpemUgPiAwKSByZXR1cm5cbiAgICB9XG5cbiAgICB2b2lkIHRoaXMuc3RvcCgpLmNhdGNoKChlcnJvcikgPT4gdGhpcy5fcmVwb3J0Q29ubmVjdGlvbkhhbmRsZXJFcnJvcihlcnJvcikpXG4gIH1cblxuICAvKipcbiAgICogV2lyZXMgdXAgdGhlIGRpc3BhdGNoLXRyaWdnZXJpbmcgc2lnbmFsIHNvdXJjZXMgZm9yIHRoZSBjb25maWd1cmVkXG4gICAqIHN0cmF0ZWd5LiBJbiBgXCJiZWFjb25cImAgbW9kZSAoZGVmYXVsdCkgdGhpcyBtZWFucyBzdWJzY3JpYmluZyB0byB0aGVcbiAgICogYHZlbG9jaW91cy1iYWNrZ3JvdW5kLWpvYnMtZGlzcGF0Y2hgIGNoYW5uZWwgZm9yIGNyb3NzLXByb2Nlc3NcbiAgICogd2FrZS11cHMsIGxpc3RlbmluZyBmb3IgQmVhY29uIChyZSljb25uZWN0cyB0byBjYXRjaCB1cCBvbiBtaXNzZWRcbiAgICogd29yaywgYW5kIHJlbHlpbmcgb24gZGlyZWN0IGluLXByb2Nlc3MgY2FsbHMgZnJvbSBgX2hhbmRsZUVucXVldWVgLFxuICAgKiBgX2hhbmRsZUpvYkNvbXBsZXRlYC9gRmFpbGVkYCwgd29ya2VyIGhlbGxvL3JlYWR5LCBhbmQgdGhlXG4gICAqIHNjaGVkdWxlZC1qb2IgYHNldFRpbWVvdXRgLiBJbiBgXCJwb2xsaW5nXCJgIG1vZGUgd2UgcmVzdG9yZSB0aGVcbiAgICogbGVnYWN5IGZpeGVkLWludGVydmFsIHBvbGwgZm9yIHVzZXJzIHdobyB3YW50IHRoZSBwcmV2aW91cyBiZWhhdmlvci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2V0dXBEaXNwYXRjaFRyaWdnZXJzKCkge1xuICAgIGlmICh0aGlzLmRpc3BhdGNoU3RyYXRlZ3kgPT09IFwicG9sbGluZ1wiKSB7XG4gICAgICB0aGlzLl9wb2xsVGltZXIgPSBzZXRJbnRlcnZhbCgoKSA9PiB7XG4gICAgICAgIHZvaWQgdGhpcy5fcmV0cnlBZnRlckVycm9yKClcbiAgICAgIH0sIHRoaXMucG9sbEludGVydmFsTXMpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBiZWFjb25DbGllbnQgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmVhY29uQ2xpZW50KClcbiAgICBpZiAoIWJlYWNvbkNsaWVudCkgcmV0dXJuXG5cbiAgICB0aGlzLl9iZWFjb25DbGllbnQgPSBiZWFjb25DbGllbnRcblxuICAgIHRoaXMuX3Vuc3Vic2NyaWJlQmVhY29uID0gYmVhY29uQ2xpZW50Lm9uQnJvYWRjYXN0KChtZXNzYWdlKSA9PiB7XG4gICAgICBpZiAobWVzc2FnZT8uY2hhbm5lbCAhPT0gRElTUEFUQ0hfQ0hBTk5FTCkgcmV0dXJuXG4gICAgICB2b2lkIHRoaXMuX2RyYWluKClcbiAgICB9KVxuXG4gICAgLy8gRHJhaW4gb24gZXZlcnkgKHJlKWNvbm5lY3QgdG8gY2F0Y2ggdXAgb24gam9icyBlbnF1ZXVlZCB3aGlsZSB0aGVcbiAgICAvLyBidXMgd2FzIHVucmVhY2hhYmxlLiBUaGUgREIgaXMgdGhlIGR1cmFibGUgbG9nOyBCZWFjb24gaXMganVzdCB0aGVcbiAgICAvLyB3YWtlLXVwIHNpZ25hbC5cbiAgICB0aGlzLl9iZWFjb25Db25uZWN0SGFuZGxlciA9ICgpID0+IHtcbiAgICAgIHZvaWQgdGhpcy5fZHJhaW4oKVxuICAgIH1cbiAgICBiZWFjb25DbGllbnQub24oXCJjb25uZWN0XCIsIHRoaXMuX2JlYWNvbkNvbm5lY3RIYW5kbGVyKVxuICB9XG5cbiAgLyoqXG4gICAqIEFybXMgdGhlIGJvdW5kZWQgYWRvcHRpb24gZ3JhY2Ugb25seSB3aGVuIHN0YXJ0dXAgZm91bmQgZXhhY3QgcGVyc2lzdGVkXG4gICAqIGhhbmRvZmZzLiBUaGUgdGltZXIgaXMgdW5yZWZlZCBzbyBhbiBvdGhlcndpc2UtZmluaXNoZWQgcHJvY2VzcyBpcyBuZXZlclxuICAgKiByZXRhaW5lZCBzb2xlbHkgdG8gcGVyZm9ybSB0aGlzIGNsZWFudXAuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3NldHVwU3RhcnR1cEhhbmRvZmZSZWNsYWltKCkge1xuICAgIGlmICh0aGlzLnN0YXJ0dXBIYW5kb2ZmU25hcHNob3QubGVuZ3RoID09PSAwKSByZXR1cm5cbiAgICBpZiAodGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltVGltZXIgfHwgdGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltUHJvbWlzZSB8fCB0aGlzLl9zdGFydHVwSGFuZG9mZkdyYWNlRWxhcHNlZCkgcmV0dXJuXG5cbiAgICB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1UaW1lciA9IHRoaXMuY2xvY2suc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1UaW1lciA9IHVuZGVmaW5lZFxuICAgICAgdGhpcy5fc3RhcnR1cEhhbmRvZmZBZG9wdGlvbnNBdERlYWRsaW5lID0gWy4uLnRoaXMuaW5mbGlnaHRXb3JrZXJIYW5kb2ZmQWRvcHRpb25zXVxuICAgICAgdGhpcy5fc3RhcnR1cEhhbmRvZmZHcmFjZUVsYXBzZWQgPSB0cnVlXG4gICAgICB2b2lkIHRoaXMuX3N0YXJ0U3RhcnR1cEhhbmRvZmZSZWNsYWltKClcbiAgICB9LCB0aGlzLndvcmtlclJlY29ubmVjdEdyYWNlTXMpXG4gICAgaWYgKHR5cGVvZiB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1UaW1lciA9PT0gXCJvYmplY3RcIikgdGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltVGltZXIudW5yZWYoKVxuICB9XG5cbiAgLyoqXG4gICAqIFN0YXJ0cyBvbmUgdHJhY2tlZCBzdGFydHVwLXJlY2xhaW0gcGFzcywgY29hbGVzY2luZyBsaWZlY3ljbGUgYW5kIHJldHJ5XG4gICAqIGNhbGxlcnMgc28gc2h1dGRvd24gY2FuIHdhaXQgZm9yIGR1cmFibGUgbXV0YXRpb24gYmVmb3JlIGNsb3NpbmcgcG9vbHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoaXMgcGFzcyBzZXR0bGVzLlxuICAgKi9cbiAgX3N0YXJ0U3RhcnR1cEhhbmRvZmZSZWNsYWltKCkge1xuICAgIGlmICh0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1Qcm9taXNlKSByZXR1cm4gdGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltUHJvbWlzZVxuXG4gICAgY29uc3QgcmVjbGFpbSA9IHRoaXMuX3JlY2xhaW1EaXNjb25uZWN0ZWRTdGFydHVwSGFuZG9mZnMoKVxuXG4gICAgdGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltUHJvbWlzZSA9IHJlY2xhaW1cbiAgICBjb25zdCBjbGVhclJlY2xhaW0gPSAoKSA9PiB7XG4gICAgICBpZiAodGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltUHJvbWlzZSA9PT0gcmVjbGFpbSkge1xuICAgICAgICB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1Qcm9taXNlID0gdW5kZWZpbmVkXG4gICAgICB9XG4gICAgfVxuICAgIHZvaWQgcmVjbGFpbS50aGVuKGNsZWFyUmVjbGFpbSwgY2xlYXJSZWNsYWltKVxuXG4gICAgcmV0dXJuIHJlY2xhaW1cbiAgfVxuXG4gIC8qKlxuICAgKiBXYWl0cyBmb3IgYW4gYWxyZWFkeS1zdGFydGVkIHN0YXJ0dXAgcmVjbGFpbSBiZWZvcmUgYWRhcHRlciBzaHV0ZG93bi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBubyBwYXNzIHJlbWFpbnMuXG4gICAqL1xuICBhc3luYyBfZHJhaW5TdGFydHVwSGFuZG9mZlJlY2xhaW0oKSB7XG4gICAgd2hpbGUgKHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVByb21pc2UpIHtcbiAgICAgIGF3YWl0IHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVByb21pc2VcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogT3JwaGFucyBvbmx5IHN0YXJ0dXAtc25hcHNob3R0ZWQgbGVhc2VzIHdob3NlIHN0YWJsZSB3b3JrZXIgaWQgaGFzIG5vdCBiZWVuXG4gICAqIG9ic2VydmVkIGJ5IHRoaXMgbWFpbiBnZW5lcmF0aW9uLiBTdG9yZSBmZW5jaW5nIHJlamVjdHMgY29tcGxldGVkLFxuICAgKiByZXR1cm5lZCwgcmVwbGFjZWQsIGFuZCByZS1oYW5kZWQtb2ZmIHJvd3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHJlY2xhaW0gb3IgcmV0YWluZWQgcmV0cnkgc3RhdGUuXG4gICAqL1xuICBhc3luYyBfcmVjbGFpbURpc2Nvbm5lY3RlZFN0YXJ0dXBIYW5kb2ZmcygpIHtcbiAgICBpZiAodGhpcy5fc3RvcHBlZCB8fCAhdGhpcy5fc3RhcnR1cEhhbmRvZmZHcmFjZUVsYXBzZWQpIHJldHVyblxuICAgIGlmICh0aGlzLnN0YXJ0dXBIYW5kb2ZmU25hcHNob3QubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIGF3YWl0IHRoaXMuX3dhaXRGb3JTdGFydHVwSGFuZG9mZkFkb3B0aW9uc0F0RGVhZGxpbmUoKVxuICAgIGlmICh0aGlzLl9zdG9wcGVkKSByZXR1cm5cblxuICAgIGNvbnN0IGhhbmRvZmZzID0gdGhpcy5zdGFydHVwSGFuZG9mZlNuYXBzaG90LmZpbHRlcigoe3dvcmtlcklkfSkgPT4gIXRoaXMucmVjb25uZWN0ZWRXb3JrZXJJZHMuaGFzKHdvcmtlcklkKSlcblxuICAgIGlmIChoYW5kb2Zmcy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRoaXMuc3RhcnR1cEhhbmRvZmZTbmFwc2hvdCA9IFtdXG4gICAgICB0aGlzLl9tYXliZVN0b3BSZXRpcmVkKClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGxldCBvcnBoYW5lZEpvYnNcblxuICAgIHRyeSB7XG4gICAgICBvcnBoYW5lZEpvYnMgPSBhd2FpdCB0aGlzLnN0b3JlLm1hcmtPcnBoYW5lZEhhbmRvZmZzKHtcbiAgICAgICAgZXJyb3I6IFwiSm9iIG9ycGhhbmVkIGFmdGVyIGl0cyBwcmUtcmVzdGFydCB3b3JrZXIgZGlkIG5vdCByZWNvbm5lY3RcIixcbiAgICAgICAgaGFuZG9mZnNcbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuX3JlcG9ydFN0YXJ0dXBIYW5kb2ZmUmVjbGFpbUVycm9yKGVycm9yKVxuICAgICAgdGhpcy5fc2NoZWR1bGVFcnJvclJldHJ5KClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuc3RhcnR1cEhhbmRvZmZTbmFwc2hvdCA9IFtdXG4gICAgYXdhaXQgdGhpcy5faGFuZGxlT3JwaGFuZWRKb2JzKHtcbiAgICAgIGpvYnM6IG9ycGhhbmVkSm9icyxcbiAgICAgIHdhcm5pbmc6IFwiUmVjbGFpbWVkIGJhY2tncm91bmQgam9icyBmcm9tIHdvcmtlcnMgYWJzZW50IGFmdGVyIG1haW4gcmVzdGFydCBncmFjZVwiXG4gICAgfSlcbiAgICB0aGlzLm9uU3RhcnR1cEhhbmRvZmZzUmVjbGFpbWVkPy4ob3JwaGFuZWRKb2JzKVxuICAgIHRoaXMuX21heWJlU3RvcFJldGlyZWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIExldHMgYWRvcHRpb24gcXVlcmllcyBhbHJlYWR5IHJ1bm5pbmcgYXQgdGhlIHJlY29ubmVjdCBkZWFkbGluZSBzZXR0bGVcbiAgICogYmVmb3JlIHdvcmtlciBpZHMgYXJlIGZpbHRlcmVkLiBBIHNlY29uZCBib3VuZGVkIGdyYWNlIHByZXZlbnRzIGEgc3R1Y2tcbiAgICogYWRhcHRlciBxdWVyeSBmcm9tIGRlZmVycmluZyBzdGFydHVwIHJlY2xhaW0gZm9yZXZlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgZGVhZGxpbmUgc2V0IHNldHRsZXMgb3IgdGltZXMgb3V0LlxuICAgKi9cbiAgYXN5bmMgX3dhaXRGb3JTdGFydHVwSGFuZG9mZkFkb3B0aW9uc0F0RGVhZGxpbmUoKSB7XG4gICAgY29uc3QgYWRvcHRpb25zID0gdGhpcy5fc3RhcnR1cEhhbmRvZmZBZG9wdGlvbnNBdERlYWRsaW5lXG5cbiAgICB0aGlzLl9zdGFydHVwSGFuZG9mZkFkb3B0aW9uc0F0RGVhZGxpbmUgPSBbXVxuICAgIGlmIChhZG9wdGlvbnMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IHRpbWVyXG4gICAgY29uc3Qgd2FpdExpbWl0ID0gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIC8vIFRoaXMgbGlmZWN5Y2xlIGRlYWRsaW5lIG11c3Qgbm90IGtlZXAgdGhlIG1haW4gcHJvY2VzcyBhbGl2ZTsgdGhlXG4gICAgICAvLyBnZW5lcmljIHRpbWVvdXQgaGVscGVyIGludGVudGlvbmFsbHkgdXNlcyBhIHJlZmVyZW5jZWQgdGltZXIuXG4gICAgICB0aW1lciA9IHNldFRpbWVvdXQocmVzb2x2ZSwgdGhpcy53b3JrZXJSZWNvbm5lY3RHcmFjZU1zKVxuICAgICAgdGltZXIudW5yZWYoKVxuICAgIH0pXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgUHJvbWlzZS5yYWNlKFtQcm9taXNlLmFsbChhZG9wdGlvbnMpLCB3YWl0TGltaXRdKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAodGltZXIpIGNsZWFyVGltZW91dCh0aW1lcilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUHVibGlzaGVzIGEgZGlzcGF0Y2ggd2FrZS11cCBvbiB0aGUgQmVhY29uIGNoYW5uZWwuIE5vLW9wIGluIHBvbGxpbmdcbiAgICogbW9kZSBvciB3aGVuIEJlYWNvbiBpcyBub3QgY29ubmVjdGVkOyBpbiB0aG9zZSBjYXNlcyB0aGUgZGlyZWN0XG4gICAqIGluLXByb2Nlc3MgYF9kcmFpbigpYCBjYWxsIGluIHRoZSBlbnF1ZXVlL2hhbmRsZSBwYXRocyBpcyBzdWZmaWNpZW50XG4gICAqICh0aGVyZSBhcmUgbm8gb3RoZXIgcHJvY2Vzc2VzIHRvIG5vdGlmeSkuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX25vdGlmeUVucXVldWVkKCkge1xuICAgIGlmICh0aGlzLmRpc3BhdGNoU3RyYXRlZ3kgPT09IFwicG9sbGluZ1wiKSByZXR1cm5cblxuICAgIGNvbnN0IGJlYWNvbkNsaWVudCA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCZWFjb25DbGllbnQoKVxuICAgIGlmICghYmVhY29uQ2xpZW50IHx8ICFiZWFjb25DbGllbnQuaXNDb25uZWN0ZWQoKSkgcmV0dXJuXG5cbiAgICB0cnkge1xuICAgICAgYmVhY29uQ2xpZW50LnB1Ymxpc2goe1xuICAgICAgICBjaGFubmVsOiBESVNQQVRDSF9DSEFOTkVMLFxuICAgICAgICBicm9hZGNhc3RQYXJhbXM6IHt9LFxuICAgICAgICBib2R5OiB7YWN0aW9uOiBcIndha2VcIn1cbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oKCkgPT4gW1wiRmFpbGVkIHRvIHB1Ymxpc2ggYmFja2dyb3VuZCBqb2JzIHdha2UgYnJvYWRjYXN0OlwiLCBlcnJvcl0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibmV0XCIpLlNvY2tldH0gc29ja2V0IC0gU29ja2V0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9oYW5kbGVDb25uZWN0aW9uKHNvY2tldCkge1xuICAgIGNvbnN0IGpzb25Tb2NrZXQgPSBuZXcgSnNvblNvY2tldChzb2NrZXQpXG4gICAgdGhpcy5jb25uZWN0aW9ucy5hZGQoanNvblNvY2tldClcbiAgICAvKipcbiAgICAgKiBSb2xlLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTb2NrZXRSb2xlIHwgbnVsbH0gKi9cbiAgICBsZXQgcm9sZSA9IG51bGxcblxuICAgIGxldCBjbGVhbmVkVXAgPSBmYWxzZVxuICAgIGNvbnN0IGNsZWFudXAgPSAoKSA9PiB7XG4gICAgICBpZiAoY2xlYW5lZFVwKSByZXR1cm5cbiAgICAgIGNsZWFuZWRVcCA9IHRydWVcbiAgICAgIHRoaXMuY29ubmVjdGlvbnMuZGVsZXRlKGpzb25Tb2NrZXQpXG5cbiAgICAgIGlmIChyb2xlID09PSBcIndvcmtlclwiKSB2b2lkIHRoaXMuX2hhbmRsZVdvcmtlclNvY2tldENsb3NlZChqc29uU29ja2V0KVxuICAgICAgdGhpcy5fbWF5YmVTdG9wUmV0aXJlZCgpXG4gICAgfVxuXG4gICAganNvblNvY2tldC5vbihcImNsb3NlXCIsIGNsZWFudXApXG4gICAganNvblNvY2tldC5vbihcImVycm9yXCIsIChlcnJvcikgPT4ge1xuICAgICAgdGhpcy5sb2dnZXIud2FybigoKSA9PiBbXCJCYWNrZ3JvdW5kIGpvYnMgY29ubmVjdGlvbiBlcnJvcjpcIiwgZXJyb3JdKVxuICAgICAgY2xlYW51cCgpXG4gICAgfSlcblxuICAgIGxldCBtZXNzYWdlSGFuZGxpbmcgPSBQcm9taXNlLnJlc29sdmUoKVxuICAgIGpzb25Tb2NrZXQub24oXCJtZXNzYWdlXCIsIChtZXNzYWdlKSA9PiB7XG4gICAgICBtZXNzYWdlSGFuZGxpbmcgPSBtZXNzYWdlSGFuZGxpbmcudGhlbihhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGV4aXN0aW5nUm9sZSA9IHJvbGVcbiAgICAgICAgcm9sZSA9IGF3YWl0IHRoaXMuX2hhbmRsZVNvY2tldE1lc3NhZ2Uoe2pzb25Tb2NrZXQsIG1lc3NhZ2UsIHJvbGV9KVxuICAgICAgICBpZiAoZXhpc3RpbmdSb2xlID09PSBcImNsaWVudFwiIHx8IGV4aXN0aW5nUm9sZSA9PT0gXCJyZXBvcnRlclwiKSBqc29uU29ja2V0LmNsb3NlKClcbiAgICAgIH0pLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgICB0aGlzLl9yZXBvcnRDb25uZWN0aW9uSGFuZGxlckVycm9yKGVycm9yKVxuICAgICAgICBqc29uU29ja2V0LmNsb3NlKClcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTdXJmYWNlcyBhbiB1bmV4cGVjdGVkIHByb3RvY29sLWhhbmRsZXIgZmFpbHVyZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBIYW5kbGVyIGZhaWx1cmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlcG9ydENvbm5lY3Rpb25IYW5kbGVyRXJyb3IoZXJyb3IpIHtcbiAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICBjb25zdCBwYXlsb2FkID0ge2NvbnRleHQ6IHtzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYnMtc29ja2V0LWhhbmRsZXJcIn0sIGVycm9yOiBub3JtYWxpemVkRXJyb3J9XG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiQmFja2dyb3VuZCBqb2JzIHNvY2tldCBoYW5kbGVyIGZhaWxlZDpcIiwgbm9ybWFsaXplZEVycm9yXSlcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiZnJhbWV3b3JrLWVycm9yXCIsIHBheWxvYWQpXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4ucGF5bG9hZCwgZXJyb3JUeXBlOiBcImZyYW1ld29yay1lcnJvclwifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBzb2NrZXQgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNvY2tldE1lc3NhZ2V9IGFyZ3MubWVzc2FnZSAtIFNvY2tldCBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNvY2tldFJvbGUgfCBudWxsfSBhcmdzLnJvbGUgLSBDdXJyZW50IHNvY2tldCByb2xlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTb2NrZXRSb2xlIHwgbnVsbD59IC0gVXBkYXRlZCBzb2NrZXQgcm9sZS5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVTb2NrZXRNZXNzYWdlKHtqc29uU29ja2V0LCBtZXNzYWdlLCByb2xlfSkge1xuICAgIGlmICghcm9sZSkgcmV0dXJuIGF3YWl0IHRoaXMuX2hhbmRsZVJvbGVsZXNzU29ja2V0TWVzc2FnZSh7anNvblNvY2tldCwgbWVzc2FnZX0pXG4gICAgaWYgKHJvbGUgPT09IFwid29ya2VyXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZVdvcmtlclNvY2tldE1lc3NhZ2Uoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KVxuICAgICAgcmV0dXJuIHJvbGVcbiAgICB9XG5cbiAgICB0aGlzLl9hY3RpdmVOb25Xb3JrZXJSZXF1ZXN0cyArPSAxXG4gICAgdHJ5IHtcbiAgICAgIGlmIChyb2xlID09PSBcImNsaWVudFwiKSBhd2FpdCB0aGlzLl9oYW5kbGVDbGllbnRTb2NrZXRNZXNzYWdlKHtqc29uU29ja2V0LCBtZXNzYWdlfSlcbiAgICAgIGlmIChyb2xlID09PSBcInJlcG9ydGVyXCIpIGF3YWl0IHRoaXMuX2hhbmRsZVJlcG9ydGVyU29ja2V0TWVzc2FnZSh7anNvblNvY2tldCwgbWVzc2FnZX0pXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX2FjdGl2ZU5vbldvcmtlclJlcXVlc3RzIC09IDFcbiAgICAgIHRoaXMuX21heWJlU3RvcFJldGlyZWQoKVxuICAgIH1cblxuICAgIHJldHVybiByb2xlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgcm9sZWxlc3Mgc29ja2V0IG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLmpzb25Tb2NrZXQgLSBKU09OIHNvY2tldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTb2NrZXRNZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBTb2NrZXQgbWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU29ja2V0Um9sZSB8IG51bGw+fSAtIE5ldyBzb2NrZXQgcm9sZS5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVSb2xlbGVzc1NvY2tldE1lc3NhZ2Uoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KSB7XG4gICAgaWYgKG1lc3NhZ2U/LnR5cGUgIT09IFwiaGVsbG9cIikgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHJlamVjdGlvblJlYXNvbiA9IHRoaXMuX2dlbmVyYXRpb25IZWxsb1JlamVjdGlvblJlYXNvbihtZXNzYWdlKVxuXG4gICAgaWYgKHJlamVjdGlvblJlYXNvbikge1xuICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImdlbmVyYXRpb24tcmVqZWN0ZWRcIiwgcmVhc29uOiByZWplY3Rpb25SZWFzb259KVxuICAgICAganNvblNvY2tldC5jbG9zZSgpXG4gICAgICByZXR1cm4gbnVsbFxuICAgIH1cblxuICAgIGlmIChtZXNzYWdlLnJvbGUgPT09IFwid29ya2VyXCIpIHtcbiAgICAgIGlmICh0aGlzLl9zdG9wcGVkKSB7XG4gICAgICAgIGpzb25Tb2NrZXQuY2xvc2UoKVxuICAgICAgICByZXR1cm4gbWVzc2FnZS5yb2xlXG4gICAgICB9XG5cbiAgICAgIGlmICghKGF3YWl0IHRoaXMuX3JlZ2lzdGVyV29ya2VyKHtqc29uU29ja2V0LCBtZXNzYWdlfSkpKSByZXR1cm4gbnVsbFxuICAgIH1cblxuICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCkge1xuICAgICAganNvblNvY2tldC5zZW5kKHtcbiAgICAgICAgdHlwZTogXCJnZW5lcmF0aW9uLWFjY2VwdGVkXCIsXG4gICAgICAgIGdlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWQsXG4gICAgICAgIGxpZmVjeWNsZVN0YXRlOiB0aGlzLmxpZmVjeWNsZVN0YXRlXG4gICAgICB9KVxuICAgICAgaWYgKG1lc3NhZ2Uucm9sZSA9PT0gXCJ3b3JrZXJcIiAmJiAodGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJyZXRpcmluZ1wiIHx8IHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwicmV0aXJlZFwiKSkge1xuICAgICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwicmV0aXJlXCIsIGdlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWR9KVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBtZXNzYWdlLnJvbGVcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgdGhlIGdlbmVyYXRpb24gZmVuY2UgYmVmb3JlIGFzc2lnbmluZyBhIHNvY2tldCByb2xlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhlbGxvTWVzc2FnZX0gbWVzc2FnZSAtIEhlbGxvIG1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JzR2VuZXJhdGlvblJlamVjdGlvblJlYXNvbiB8IG51bGx9IC0gUmVqZWN0aW9uIHJlYXNvbi5cbiAgICovXG4gIF9nZW5lcmF0aW9uSGVsbG9SZWplY3Rpb25SZWFzb24obWVzc2FnZSkge1xuICAgIGNvbnN0IG1lc3NhZ2VIYXNHZW5lcmF0aW9uID0gT2JqZWN0Lmhhc093bihtZXNzYWdlLCBcImdlbmVyYXRpb25JZFwiKVxuXG4gICAgaWYgKCF0aGlzLmdlbmVyYXRpb25JZCkgcmV0dXJuIG1lc3NhZ2VIYXNHZW5lcmF0aW9uID8gXCJ1bmV4cGVjdGVkLWdlbmVyYXRpb25cIiA6IG51bGxcbiAgICBpZiAoIW1lc3NhZ2VIYXNHZW5lcmF0aW9uKSByZXR1cm4gXCJtaXNzaW5nLWdlbmVyYXRpb25cIlxuXG4gICAgdHJ5IHtcbiAgICAgIHZhbGlkYXRlR2VuZXJhdGlvbklkKG1lc3NhZ2UuZ2VuZXJhdGlvbklkLCBcImhlbGxvIGdlbmVyYXRpb25JZFwiKVxuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIFwibWFsZm9ybWVkLWdlbmVyYXRpb25cIlxuICAgIH1cblxuICAgIGlmIChtZXNzYWdlLmdlbmVyYXRpb25JZCAhPT0gdGhpcy5nZW5lcmF0aW9uSWQpIHJldHVybiBcImdlbmVyYXRpb24tbWlzbWF0Y2hcIlxuICAgIGlmIChtZXNzYWdlLnJvbGUgPT09IFwid29ya2VyXCIgJiYgIXdvcmtlcklkQmVsb25nc1RvR2VuZXJhdGlvbih7Z2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZCwgd29ya2VySWQ6IG1lc3NhZ2Uud29ya2VySWR9KSkge1xuICAgICAgcmV0dXJuIFwiZ2VuZXJhdGlvbi1taXNtYXRjaFwiXG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSBnZW5lcmF0aW9uLWZlbmNlZCB3b3JrZXIgYW5kIHRyYW5zZmVycyBvbmx5IGl0cyBleGFjdCBvd25lcnNoaXAuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gV29ya2VyIGhlbGxvLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIE5ldyBzb2NrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGVsbG9NZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBIZWxsby5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgd29ya2VyIHdhcyBhZG1pdHRlZC5cbiAgICovXG4gIGFzeW5jIF9yZWdpc3Rlcldvcmtlcih7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICBqc29uU29ja2V0LndvcmtlcklkID0gbWVzc2FnZS53b3JrZXJJZFxuICAgIGpzb25Tb2NrZXQuc3VwcG9ydHNIYW5kb2ZmSWRSZXBvcnRpbmcgPSBtZXNzYWdlLnN1cHBvcnRzSGFuZG9mZklkUmVwb3J0aW5nID09PSB0cnVlXG4gICAganNvblNvY2tldC5zdXBwb3J0c0hlYXJ0YmVhdCA9IG1lc3NhZ2Uuc3VwcG9ydHNIZWFydGJlYXQgPT09IHRydWVcbiAgICBqc29uU29ja2V0Lmxhc3RTZWVuQXQgPSB0aGlzLmNsb2NrLm5vdygpXG5cbiAgICBjb25zdCB3b3JrZXJJZCA9IGpzb25Tb2NrZXQud29ya2VySWRcbiAgICBjb25zdCBkaXNjb25uZWN0ZWQgPSB3b3JrZXJJZCA/IHRoaXMuZGlzY29ubmVjdGVkV29ya2Vycy5nZXQod29ya2VySWQpIDogdW5kZWZpbmVkXG4gICAgbGV0IGhhbmRvZmZzID0gZGlzY29ubmVjdGVkID8gdGhpcy53b3JrZXJIYW5kb2Zmcy5nZXQoZGlzY29ubmVjdGVkLndvcmtlcikgOiB1bmRlZmluZWRcbiAgICBjb25zdCByZWNvdmVyeU9ubHkgPSB0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcInJldGlyaW5nXCIgfHwgdGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJyZXRpcmVkXCJcblxuICAgIGlmIChyZWNvdmVyeU9ubHkgJiYgKCFoYW5kb2ZmcyB8fCBoYW5kb2Zmcy5zaXplID09PSAwKSkge1xuICAgICAgaWYgKCF3b3JrZXJJZCkgcmV0dXJuIGZhbHNlXG4gICAgICBjb25zdCBkdXJhYmxlSGFuZG9mZnMgPSBhd2FpdCB0aGlzLnN0b3JlLmhhbmRlZE9mZkpvYnNGb3JXb3JrZXIoe3dvcmtlcklkfSlcblxuICAgICAgaWYgKGR1cmFibGVIYW5kb2Zmcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImdlbmVyYXRpb24tcmVqZWN0ZWRcIiwgcmVhc29uOiBcIndvcmtlci1oYXMtbm8tcmVjb3ZlcmFibGUtaGFuZG9mZnNcIn0pXG4gICAgICAgIGpzb25Tb2NrZXQuY2xvc2UoKVxuICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgIH1cblxuICAgICAgaGFuZG9mZnMgPSBuZXcgTWFwKGR1cmFibGVIYW5kb2Zmcy5tYXAoKHtqb2JJZCwgaGFuZG9mZklkfSkgPT4gW2pvYklkLCBoYW5kb2ZmSWRdKSlcbiAgICAgIHRoaXMucmVjb25uZWN0ZWRXb3JrZXJJZHMuYWRkKHdvcmtlcklkKVxuICAgIH1cblxuICAgIGlmIChkaXNjb25uZWN0ZWQpIHtcbiAgICAgIHRoaXMuY2xvY2suY2xlYXJUaW1lb3V0KGRpc2Nvbm5lY3RlZC50aW1lcilcbiAgICAgIGlmICh3b3JrZXJJZCkgdGhpcy5kaXNjb25uZWN0ZWRXb3JrZXJzLmRlbGV0ZSh3b3JrZXJJZClcbiAgICAgIHRoaXMud29ya2VySGFuZG9mZnMuZGVsZXRlKGRpc2Nvbm5lY3RlZC53b3JrZXIpXG4gICAgfVxuXG4gICAgdGhpcy53b3JrZXJzLmFkZChqc29uU29ja2V0KVxuICAgIHRoaXMud29ya2VySGFuZG9mZnMuc2V0KGpzb25Tb2NrZXQsIGhhbmRvZmZzIHx8IG5ldyBNYXAoKSlcbiAgICBpZiAocmVjb3ZlcnlPbmx5KSBqc29uU29ja2V0LmlzRHJhaW5pbmcgPSB0cnVlXG4gICAgaWYgKCFoYW5kb2ZmcyAmJiB0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcImFjdGl2ZVwiKSB0aGlzLl90cmFja1dvcmtlckhhbmRvZmZBZG9wdGlvbihqc29uU29ja2V0KVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBUcmFja3MgYSB3b3JrZXIgaGFuZG9mZi1hZG9wdGlvbiBxdWVyeSB0aHJvdWdoIHNodXRkb3duLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGpzb25Tb2NrZXQgLSBSZWNvbm5lY3Rpbmcgd29ya2VyIHNvY2tldC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfdHJhY2tXb3JrZXJIYW5kb2ZmQWRvcHRpb24oanNvblNvY2tldCkge1xuICAgIGNvbnN0IGFkb3B0aW9uID0gdGhpcy5fYWRvcHRXb3JrZXJIYW5kb2Zmcyhqc29uU29ja2V0KVxuICAgIHRoaXMuaW5mbGlnaHRXb3JrZXJIYW5kb2ZmQWRvcHRpb25zLmFkZChhZG9wdGlvbilcbiAgICBjb25zdCByZW1vdmVBZG9wdGlvbiA9ICgpID0+IHtcbiAgICAgIHRoaXMuaW5mbGlnaHRXb3JrZXJIYW5kb2ZmQWRvcHRpb25zLmRlbGV0ZShhZG9wdGlvbilcbiAgICAgIHRoaXMuX21heWJlU3RvcFJldGlyZWQoKVxuICAgIH1cbiAgICB2b2lkIGFkb3B0aW9uLnRoZW4ocmVtb3ZlQWRvcHRpb24sIHJlbW92ZUFkb3B0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFdhaXRzIGZvciB3b3JrZXIgaGFuZG9mZi1hZG9wdGlvbiBxdWVyaWVzIHRvIGZpbmlzaC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBubyBhZG9wdGlvbiBxdWVyeSByZW1haW5zLlxuICAgKi9cbiAgYXN5bmMgX2RyYWluV29ya2VySGFuZG9mZkFkb3B0aW9ucygpIHtcbiAgICB3aGlsZSAodGhpcy5pbmZsaWdodFdvcmtlckhhbmRvZmZBZG9wdGlvbnMuc2l6ZSA+IDApIHtcbiAgICAgIGF3YWl0IFByb21pc2UuYWxsKFsuLi50aGlzLmluZmxpZ2h0V29ya2VySGFuZG9mZkFkb3B0aW9uc10pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFkb3B0cyBhIHJlY29ubmVjdGluZyB3b3JrZXIncyBzdGlsbC1hY3RpdmUgYGhhbmRlZF9vZmZgIGpvYnMgaW50byBpdHMgbmV3XG4gICAqIHNvY2tldCdzIGhhbmRvZmYgbWFwLiBBIGZyZXNoIG1haW4gKGUuZy4gYWZ0ZXIgYSBkZXBsb3kgcmVzdGFydCkgaG9sZHMgbm9cbiAgICogaW4tbWVtb3J5IGxlYXNlcywgc28gYSB3b3JrZXIgdGhhdCByZWNvbm5lY3RzIHdpdGggaXRzIHN0YWJsZSBpZCB3b3VsZFxuICAgKiBvdGhlcndpc2UgaGF2ZSBpdHMgcHJlLXJlc3RhcnQgam9icyB0cmFja2VkIG5vd2hlcmUg4oCUIGlmIGl0IHRoZW4gZGllZCwgdGhvc2VcbiAgICogbGVhc2VzIChhbmQgdGhlaXIgY29uY3VycmVuY3kgcmVzZXJ2YXRpb25zKSB3b3VsZCBzaXQgc3R1Y2sgdW50aWwgdGhlXG4gICAqIGhvdXJzLWxvbmcgb3JwaGFuIHN3ZWVwLiBBZG9wdGluZyB0aGVtIG1lYW5zIGBfaGFuZGxlV29ya2VyU29ja2V0Q2xvc2VkYFxuICAgKiByZWxlYXNlcyB0aGVtIG9uIHRoZSB3b3JrZXIncyBuZXh0IGRpc2Nvbm5lY3QsIHdoaWxlIGEgc3RpbGwtcnVubmluZyB3b3JrZXJcbiAgICogKGluY2x1ZGluZyBvbmUgZ3JhY2VmdWxseSBkcmFpbmluZykga2VlcHMgZXhlY3V0aW5nIHRoZW0gdW50b3VjaGVkLiBOb1xuICAgKiB0aW1lLWJhc2VkIHJlY2xhaW0gaXMgdXNlZCwgc28gYSBkcmFpbmluZyB3b3JrZXIgd2hvc2Ugam9icyBvdXRsaXZlIHRoZSBvbGRcbiAgICogbWFpbiBpcyBuZXZlciB3cm9uZ2x5IHJlcXVldWVkIGludG8gYSBkdXBsaWNhdGUgYXR0ZW1wdC5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBqc29uU29ja2V0IC0gVGhlIHJlY29ubmVjdGVkIHdvcmtlciBzb2NrZXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2Fkb3B0V29ya2VySGFuZG9mZnMoanNvblNvY2tldCkge1xuICAgIGNvbnN0IHdvcmtlcklkID0ganNvblNvY2tldC53b3JrZXJJZFxuXG4gICAgaWYgKHR5cGVvZiB3b3JrZXJJZCAhPT0gXCJzdHJpbmdcIiB8fCB3b3JrZXJJZC5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGhhbmRvZmZzID0gYXdhaXQgdGhpcy5zdG9yZS5oYW5kZWRPZmZKb2JzRm9yV29ya2VyKHt3b3JrZXJJZH0pXG4gICAgICBjb25zdCBtYXAgPSB0aGlzLndvcmtlckhhbmRvZmZzLmdldChqc29uU29ja2V0KVxuXG4gICAgICAvLyBUaGUgc29ja2V0IG1heSBoYXZlIGNsb3NlZCB3aGlsZSB0aGUgcXVlcnkgd2FzIGluIGZsaWdodDsgaXRzIG1hcCBpcyB0aGVuXG4gICAgICAvLyBnb25lIGFuZCB0aGUgam9icyBhcmUgbGVmdCBmb3IgdGhlIG9ycGhhbiBzd2VlcCByYXRoZXIgdGhhbiByZXN1cnJlY3RlZC5cbiAgICAgIGlmICghbWFwIHx8ICF0aGlzLndvcmtlcnMuaGFzKGpzb25Tb2NrZXQpKSByZXR1cm5cblxuICAgICAgZm9yIChjb25zdCB7am9iSWQsIGhhbmRvZmZJZH0gb2YgaGFuZG9mZnMpIHtcbiAgICAgICAgbWFwLnNldChqb2JJZCwgaGFuZG9mZklkKVxuICAgICAgfVxuICAgICAgdGhpcy5yZWNvbm5lY3RlZFdvcmtlcklkcy5hZGQod29ya2VySWQpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuX3JlcG9ydEhhbmRvZmZBZG9wdEVycm9yKGVycm9yKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBjbGllbnQgc29ja2V0IG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLmpzb25Tb2NrZXQgLSBKU09OIHNvY2tldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTb2NrZXRNZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBTb2NrZXQgbWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHJlcXVlc3QgaXMgYWNrbm93bGVkZ2VkLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZUNsaWVudFNvY2tldE1lc3NhZ2Uoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KSB7XG4gICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkICYmICh0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcInJldGlyaW5nXCIgfHwgdGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJyZXRpcmVkXCIpKSB7XG4gICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJlbnF1ZXVlXCIgJiYgIW1lc3NhZ2UucHJvZHVjZXJQcm9vZikganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImVucXVldWUtZXJyb3JcIiwgZXJyb3I6IFwiQmFja2dyb3VuZCBqb2JzIGdlbmVyYXRpb24gaXMgcmV0aXJlZFwifSlcbiAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcInJlcGxhY2Utc2NoZWR1bGVkXCIpIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJyZXBsYWNlLXNjaGVkdWxlZC1lcnJvclwiLCBlcnJvcjogXCJCYWNrZ3JvdW5kIGpvYnMgZ2VuZXJhdGlvbiBpcyByZXRpcmVkXCJ9KVxuICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiY2FuY2VsLXNjaGVkdWxlZFwiKSBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiY2FuY2VsLXNjaGVkdWxlZC1lcnJvclwiLCBlcnJvcjogXCJCYWNrZ3JvdW5kIGpvYnMgZ2VuZXJhdGlvbiBpcyByZXRpcmVkXCJ9KVxuICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiZ2V0LXNjaGVkdWxlZC1qb2JcIikganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImdldC1zY2hlZHVsZWQtam9iLWVycm9yXCIsIGVycm9yOiBcIkJhY2tncm91bmQgam9icyBnZW5lcmF0aW9uIGlzIHJldGlyZWRcIn0pXG4gICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJ3YWtlLXNjaGVkdWxlZFwiKSBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwid2FrZS1zY2hlZHVsZWQtZXJyb3JcIiwgZXJyb3I6IFwiQmFja2dyb3VuZCBqb2JzIGdlbmVyYXRpb24gaXMgcmV0aXJlZFwifSlcbiAgICAgIGlmIChtZXNzYWdlPy50eXBlICE9PSBcImVucXVldWVcIiB8fCAhbWVzc2FnZS5wcm9kdWNlclByb29mKSByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJlbnF1ZXVlXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZUVucXVldWUoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwicmVwbGFjZS1zY2hlZHVsZWRcIikge1xuICAgICAgYXdhaXQgdGhpcy5faGFuZGxlUmVwbGFjZVNjaGVkdWxlZCh7anNvblNvY2tldCwgbWVzc2FnZX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJjYW5jZWwtc2NoZWR1bGVkXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZUNhbmNlbFNjaGVkdWxlZCh7anNvblNvY2tldCwgbWVzc2FnZX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJnZXQtc2NoZWR1bGVkLWpvYlwiKSB7XG4gICAgICBhd2FpdCB0aGlzLl9oYW5kbGVHZXRTY2hlZHVsZWRKb2Ioe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwid2FrZS1zY2hlZHVsZWRcIikge1xuICAgICAgYXdhaXQgdGhpcy5faGFuZGxlV2FrZVNjaGVkdWxlZCh7anNvblNvY2tldCwgbWVzc2FnZX0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIHdvcmtlciBzb2NrZXQgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNvY2tldE1lc3NhZ2V9IGFyZ3MubWVzc2FnZSAtIFNvY2tldCBtZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgd29ya2VyIG1lc3NhZ2UgaXMgaGFuZGxlZC5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVXb3JrZXJTb2NrZXRNZXNzYWdlKHtqc29uU29ja2V0LCBtZXNzYWdlfSkge1xuICAgIC8vIEFueSBtZXNzYWdlIGZyb20gdGhlIHdvcmtlciBwcm92ZXMgaXQgaXMgYWxpdmU7IHRoZSBsaXZlbmVzcyBzd2VlcCB1c2VzXG4gICAgLy8gdGhpcyB0byBkZXRlY3QgYSB3ZWRnZWQvc2lsZW50IHdvcmtlci5cbiAgICBqc29uU29ja2V0Lmxhc3RTZWVuQXQgPSB0aGlzLmNsb2NrLm5vdygpXG5cbiAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJoZWFydGJlYXRcIikge1xuICAgICAgdGhpcy5vbldvcmtlckhlYXJ0YmVhdD8uKGpzb25Tb2NrZXQpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJyZWFkeVwiKSB7XG4gICAgICB0aGlzLl9oYW5kbGVXb3JrZXJSZWFkeSh7anNvblNvY2tldCwgbWVzc2FnZX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJkcmFpbmluZ1wiKSB7XG4gICAgICB0aGlzLl9oYW5kbGVXb3JrZXJEcmFpbmluZyh7anNvblNvY2tldH0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLl9oYW5kbGVSZXBvcnRlclNvY2tldE1lc3NhZ2Uoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIHJlcG9ydGVyIHNvY2tldCBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy5qc29uU29ja2V0IC0gSlNPTiBzb2NrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU29ja2V0TWVzc2FnZX0gYXJncy5tZXNzYWdlIC0gU29ja2V0IG1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSByZXBvcnQgaXMgYWNrbm93bGVkZ2VkLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZVJlcG9ydGVyU29ja2V0TWVzc2FnZSh7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQgJiYgdGhpcy5fZ2VuZXJhdGlvblJlcG9ydElzSW52YWxpZChtZXNzYWdlKSkge1xuICAgICAgaWYgKFwiam9iSWRcIiBpbiBtZXNzYWdlICYmIHR5cGVvZiBtZXNzYWdlLmpvYklkID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJqb2ItdXBkYXRlLWVycm9yXCIsIGpvYklkOiBtZXNzYWdlLmpvYklkLCBlcnJvcjogXCJHZW5lcmF0aW9uIG93bmVyc2hpcCByZWplY3RlZFwifSlcbiAgICAgIH1cbiAgICAgIHJldHVyblxuICAgIH1cbiAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJqb2ItYWNjZXB0ZWRcIikge1xuICAgICAgYXdhaXQgdGhpcy5faGFuZGxlSm9iQWNjZXB0ZWQoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiam9iLWNvbXBsZXRlXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZUpvYkNvbXBsZXRlKHtqc29uU29ja2V0LCBtZXNzYWdlfSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImpvYi1mYWlsZWRcIikge1xuICAgICAgYXdhaXQgdGhpcy5faGFuZGxlSm9iRmFpbGVkKHtqc29uU29ja2V0LCBtZXNzYWdlfSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImpvYi1yZXNjaGVkdWxlXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZUpvYlJlc2NoZWR1bGUoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJzaXN0cyBwb29sZWQtY2hpbGQgYWNjZXB0YW5jZSBldmlkZW5jZSBmb3IgYW4gYWN0aXZlIGhhbmRvZmYuIFRoZVxuICAgKiByZXBvcnQgaXMgZGlhZ25vc3RpYzogYSBzdGFsZSBsZWFzZSAoam9iIGFscmVhZHkgcmVjbGFpbWVkIG9yIHRlcm1pbmFsKVxuICAgKiBhbnN3ZXJzIHRoZSBzYW1lIGBqb2ItdXBkYXRlZGAgYWNrbm93bGVkZ2VtZW50IGFzIGFuIGFjY2VwdGVkIHJlcG9ydCwgYW5kXG4gICAqIG9ubHkgYSBzdG9yZSBmYWlsdXJlIGFuc3dlcnMgYGpvYi11cGRhdGUtZXJyb3JgIHNvIHRoZSB3b3JrZXIgY2FuIHJldHJ5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy5qc29uU29ja2V0IC0gSlNPTiBzb2NrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iQWNjZXB0ZWRNZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBNZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGhhbmRsZWQuXG4gICAqL1xuICBhc3luYyBfaGFuZGxlSm9iQWNjZXB0ZWQoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuc3RvcmUubWFya0NoaWxkQWNjZXB0ZWQoe1xuICAgICAgICBjaGlsZEluc3RhbmNlSWQ6IG1lc3NhZ2UuY2hpbGRJbnN0YW5jZUlkLFxuICAgICAgICBjaGlsZFBpZDogbWVzc2FnZS5jaGlsZFBpZCxcbiAgICAgICAgaGFuZGVkT2ZmQXRNczogbWVzc2FnZS5oYW5kZWRPZmZBdE1zLFxuICAgICAgICBoYW5kb2ZmSWQ6IG1lc3NhZ2UuaGFuZG9mZklkLFxuICAgICAgICBqb2JJZDogbWVzc2FnZS5qb2JJZCxcbiAgICAgICAgcmVjZWl2ZWRBdE1zOiBtZXNzYWdlLnJlY2VpdmVkQXRNcyxcbiAgICAgICAgc3RhcnRlZEF0TXM6IG1lc3NhZ2Uuc3RhcnRlZEF0TXMsXG4gICAgICAgIHdvcmtlcklkOiBtZXNzYWdlLndvcmtlcklkXG4gICAgICB9KVxuICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImpvYi11cGRhdGVkXCIsIGpvYklkOiBtZXNzYWdlLmpvYklkfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5fcmVwb3J0Sm9iVXBkYXRlRmFpbHVyZSh7ZXJyb3IsIGpvYklkOiBtZXNzYWdlLmpvYklkLCBzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi1hY2NlcHRlZFwifSlcbiAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJqb2ItdXBkYXRlLWVycm9yXCIsIGpvYklkOiBtZXNzYWdlLmpvYklkLCBlcnJvcjogXCJGYWlsZWQgdG8gdXBkYXRlIGpvYlwifSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVxdWlyZXMgdGhlIGNvbXBsZXRlIGR1cmFibGUgbGVhc2UgaWRlbnRpdHkgYmVmb3JlIGEgZ2VuZXJhdGlvbi1tb2RlXG4gICAqIHJlcG9ydGVyIGNhbiBtdXRhdGUgYSBqb2IuIExlZ2FjeSByZXBvcnRlcnMga2VlcCB0aGVpciBwZXJtaXNzaXZlIHByb3RvY29sLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNvY2tldE1lc3NhZ2V9IG1lc3NhZ2UgLSBSZXBvcnRlciBtZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSByZXBvcnQgbGFja3MgaXRzIGV4YWN0IGdlbmVyYXRpb24gbGVhc2UuXG4gICAqL1xuICBfZ2VuZXJhdGlvblJlcG9ydElzSW52YWxpZChtZXNzYWdlKSB7XG4gICAgaWYgKG1lc3NhZ2U/LnR5cGUgIT09IFwiam9iLWFjY2VwdGVkXCIgJiYgbWVzc2FnZT8udHlwZSAhPT0gXCJqb2ItY29tcGxldGVcIiAmJiBtZXNzYWdlPy50eXBlICE9PSBcImpvYi1mYWlsZWRcIiAmJiBtZXNzYWdlPy50eXBlICE9PSBcImpvYi1yZXNjaGVkdWxlXCIpIHJldHVybiBmYWxzZVxuICAgIGNvbnN0IGdlbmVyYXRpb25JZCA9IHRoaXMuZ2VuZXJhdGlvbklkXG4gICAgaWYgKCFnZW5lcmF0aW9uSWQpIHJldHVybiBmYWxzZVxuXG4gICAgcmV0dXJuIHR5cGVvZiBtZXNzYWdlLmhhbmRvZmZJZCAhPT0gXCJzdHJpbmdcIlxuICAgICAgfHwgdHlwZW9mIG1lc3NhZ2UuaGFuZGVkT2ZmQXRNcyAhPT0gXCJudW1iZXJcIlxuICAgICAgfHwgIXdvcmtlcklkQmVsb25nc1RvR2VuZXJhdGlvbih7Z2VuZXJhdGlvbklkLCB3b3JrZXJJZDogbWVzc2FnZS53b3JrZXJJZH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgd29ya2VyIHJlYWR5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy5qc29uU29ja2V0IC0gSlNPTiBzb2NrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUmVhZHlNZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBSZWFkeSBtZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9oYW5kbGVXb3JrZXJSZWFkeSh7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICBpZiAodGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJyZXRpcmluZ1wiIHx8IHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwicmV0aXJlZFwiKSB7XG4gICAgICB0aGlzLnJlYWR5V29ya2Vycy5kZWxldGUoanNvblNvY2tldClcbiAgICAgIHRoaXMuY2FuZGlkYXRlUmVhZHlXb3JrZXJzLmRlbGV0ZShqc29uU29ja2V0KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAganNvblNvY2tldC5yZWFkaW5lc3NWZXJzaW9uICs9IDFcbiAgICBqc29uU29ja2V0LmFjY2VwdHNTcGF3bmVkSm9icyA9IG1lc3NhZ2UuYWNjZXB0c1NwYXduZWQgIT09IGZhbHNlICYmIG1lc3NhZ2UuYWNjZXB0c0ZvcmtlZCAhPT0gZmFsc2VcbiAgICBqc29uU29ja2V0LmFjY2VwdHNGb3JrZWRKb2JzID0gbWVzc2FnZS5hY2NlcHRzRm9ya2VkICE9PSBmYWxzZVxuICAgIGpzb25Tb2NrZXQuYWNjZXB0c1Bvb2xlZEpvYnMgPSBtZXNzYWdlLmFjY2VwdHNQb29sZWQgPT09IHRydWVcbiAgICBjb25zdCBhdmFpbGFibGVQb29sZWRTbG90cyA9IG1lc3NhZ2UuYXZhaWxhYmxlUG9vbGVkU2xvdHNcbiAgICBqc29uU29ja2V0LnVzZXNQb29sZWRDYXBhY2l0eUNyZWRpdHMgPSBOdW1iZXIuaXNJbnRlZ2VyKGF2YWlsYWJsZVBvb2xlZFNsb3RzKVxuICAgIGpzb25Tb2NrZXQuYXZhaWxhYmxlUG9vbGVkU2xvdHMgPSBOdW1iZXIuaXNJbnRlZ2VyKGF2YWlsYWJsZVBvb2xlZFNsb3RzKSAmJiBhdmFpbGFibGVQb29sZWRTbG90cyAhPT0gdW5kZWZpbmVkICYmIGF2YWlsYWJsZVBvb2xlZFNsb3RzID4gMFxuICAgICAgPyBhdmFpbGFibGVQb29sZWRTbG90c1xuICAgICAgOiAwXG4gICAganNvblNvY2tldC5hY2NlcHRzSW5saW5lSm9icyA9IG1lc3NhZ2UuYWNjZXB0c0lubGluZSAhPT0gZmFsc2VcbiAgICBpZiAodGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJjYW5kaWRhdGVcIikge1xuICAgICAgdGhpcy5yZWFkeVdvcmtlcnMuZGVsZXRlKGpzb25Tb2NrZXQpXG4gICAgICBpZiAoIWpzb25Tb2NrZXQuaXNEcmFpbmluZykgdGhpcy5jYW5kaWRhdGVSZWFkeVdvcmtlcnMuYWRkKGpzb25Tb2NrZXQpXG4gICAgfSBlbHNlIGlmICh0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcImFjdGl2ZVwiICYmIHRoaXMuX2FjdGl2ZU93bmVyc2hpcFJlYWR5ICYmIGpzb25Tb2NrZXQuc3VwcG9ydHNIYW5kb2ZmSWRSZXBvcnRpbmcgJiYgIWpzb25Tb2NrZXQuaXNEcmFpbmluZykge1xuICAgICAgdGhpcy5yZWFkeVdvcmtlcnMuYWRkKGpzb25Tb2NrZXQpXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMucmVhZHlXb3JrZXJzLmRlbGV0ZShqc29uU29ja2V0KVxuICAgICAgdGhpcy5jYW5kaWRhdGVSZWFkeVdvcmtlcnMuZGVsZXRlKGpzb25Tb2NrZXQpXG4gICAgfVxuICAgIHRoaXMub25Xb3JrZXJSZWFkeT8uKGpzb25Tb2NrZXQpXG4gICAgdm9pZCB0aGlzLl9kcmFpbigpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgd29ya2VyIGRyYWluaW5nLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy5qc29uU29ja2V0IC0gSlNPTiBzb2NrZXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2hhbmRsZVdvcmtlckRyYWluaW5nKHtqc29uU29ja2V0fSkge1xuICAgIC8vIFRoZSB3b3JrZXIgaXMgc2h1dHRpbmcgZG93biBncmFjZWZ1bGx5LiBTdG9wIGRpc3BhdGNoaW5nIG5ldyBqb2JzXG4gICAgLy8gdG8gaXQgYnV0IGtlZXAgdGhlIGNvbm5lY3Rpb24gaW4gYHdvcmtlcnNgIHNvIGFueSBpbi1mbGlnaHQgam9iXG4gICAgLy8gaXQncyBzdGlsbCBkcmFpbmluZyBjYW4gcmVwb3J0IGl0cyByZXN1bHQuXG4gICAganNvblNvY2tldC5pc0RyYWluaW5nID0gdHJ1ZVxuICAgIHRoaXMucmVhZHlXb3JrZXJzLmRlbGV0ZShqc29uU29ja2V0KVxuICAgIHRoaXMuY2FuZGlkYXRlUmVhZHlXb3JrZXJzLmRlbGV0ZShqc29uU29ja2V0KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbW92ZXMgYSBsb3N0IHdvcmtlciBzb2NrZXQgYW5kIHJlbGVhc2VzIG9ubHkgbGVhc2VzIGRpc3BhdGNoZWQgdGhyb3VnaCBpdC5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSB3b3JrZXIgLSBEaXNjb25uZWN0ZWQgd29ya2VyIHNvY2tldC5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIENvb3JkaW5hdGlvbiBvcHRpb25zLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLnF1ZXVlUmVkcmFpbl0gLSBRdWV1ZSBhbm90aGVyIHBhc3MgaW5zdGVhZCBvZiBhd2FpdGluZyB0aGUgYWN0aXZlIGRyYWluLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBpdHMgYWN0aXZlIGxlYXNlcyBhcmUgcmVsZWFzZWQuXG4gICAqL1xuICBhc3luYyBfaGFuZGxlV29ya2VyU29ja2V0Q2xvc2VkKHdvcmtlciwge3F1ZXVlUmVkcmFpbiA9IGZhbHNlfSA9IHt9KSB7XG4gICAgdGhpcy53b3JrZXJzLmRlbGV0ZSh3b3JrZXIpXG4gICAgdGhpcy5yZWFkeVdvcmtlcnMuZGVsZXRlKHdvcmtlcilcbiAgICB0aGlzLmNhbmRpZGF0ZVJlYWR5V29ya2Vycy5kZWxldGUod29ya2VyKVxuXG4gICAgaWYgKHRoaXMuX3N0b3BwZWQpIHtcbiAgICAgIHRoaXMud29ya2VySGFuZG9mZnMuZGVsZXRlKHdvcmtlcilcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IGhhbmRvZmZzID0gdGhpcy53b3JrZXJIYW5kb2Zmcy5nZXQod29ya2VyKVxuICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCAmJiB3b3JrZXIud29ya2VySWQgJiYgaGFuZG9mZnMgJiYgaGFuZG9mZnMuc2l6ZSA+IDApIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5kaXNjb25uZWN0ZWRXb3JrZXJzLmdldCh3b3JrZXIud29ya2VySWQpXG4gICAgICBpZiAoZXhpc3Rpbmc/LndvcmtlciA9PT0gd29ya2VyKSByZXR1cm5cbiAgICAgIGlmIChleGlzdGluZykgdGhpcy5jbG9jay5jbGVhclRpbWVvdXQoZXhpc3RpbmcudGltZXIpXG5cbiAgICAgIGNvbnN0IHRpbWVyID0gdGhpcy5jbG9jay5zZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgdGhpcy5kaXNjb25uZWN0ZWRXb3JrZXJzLmRlbGV0ZSh3b3JrZXIud29ya2VySWQgfHwgXCJcIilcbiAgICAgICAgdm9pZCB0aGlzLl9yZWxlYXNlV29ya2VySGFuZG9mZnMod29ya2VyKS50aGVuKCgpID0+IHtcbiAgICAgICAgICBpZiAod29ya2VyLndvcmtlcklkKSB0aGlzLm9uV29ya2VySGFuZG9mZnNSZWxlYXNlZD8uKHdvcmtlci53b3JrZXJJZClcbiAgICAgICAgfSwgKGVycm9yKSA9PiB7XG4gICAgICAgICAgdGhpcy5fcmVwb3J0SGFuZG9mZlJlbGVhc2VFcnJvcihlcnJvcilcbiAgICAgICAgICB0aGlzLl9zY2hlZHVsZUVycm9yUmV0cnkoKVxuICAgICAgICB9KVxuICAgICAgfSwgdGhpcy53b3JrZXJSZWNvbm5lY3RHcmFjZU1zKVxuICAgICAgaWYgKHR5cGVvZiB0aW1lciA9PT0gXCJvYmplY3RcIikgdGltZXIudW5yZWYoKVxuICAgICAgdGhpcy5kaXNjb25uZWN0ZWRXb3JrZXJzLnNldCh3b3JrZXIud29ya2VySWQsIHt3b3JrZXIsIHRpbWVyfSlcbiAgICAgIHRoaXMub25Xb3JrZXJEaXNjb25uZWN0ZWQ/Lih3b3JrZXIud29ya2VySWQpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZVdvcmtlckhhbmRvZmZzKHdvcmtlciwge3F1ZXVlUmVkcmFpbn0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuX3JlcG9ydEhhbmRvZmZSZWxlYXNlRXJyb3IoZXJyb3IpXG4gICAgICB0aGlzLl9zY2hlZHVsZUVycm9yUmV0cnkoKVxuICAgIH1cbiAgICB0aGlzLl9tYXliZVN0b3BSZXRpcmVkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxlYXNlcyBhbGwgbGVhc2VzIHN0aWxsIG93bmVkIGJ5IG9uZSBleGFjdCB3b3JrZXIgc29ja2V0LlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IHdvcmtlciAtIFdvcmtlciBzb2NrZXQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBDb29yZGluYXRpb24gb3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5xdWV1ZVJlZHJhaW5dIC0gUXVldWUgYW5vdGhlciBwYXNzIGluc3RlYWQgb2YgYXdhaXRpbmcgdGhlIGFjdGl2ZSBkcmFpbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZmVuY2VkIHJlbGVhc2VzIGFuZCBkaXNwYXRjaCB3YWtlLXVwLlxuICAgKi9cbiAgYXN5bmMgX3JlbGVhc2VXb3JrZXJIYW5kb2Zmcyh3b3JrZXIsIHtxdWV1ZVJlZHJhaW4gPSBmYWxzZX0gPSB7fSkge1xuICAgIGNvbnN0IGhhbmRvZmZzID0gdGhpcy53b3JrZXJIYW5kb2Zmcy5nZXQod29ya2VyKVxuXG4gICAgaWYgKCFoYW5kb2ZmcyB8fCBoYW5kb2Zmcy5zaXplID09PSAwKSB7XG4gICAgICB0aGlzLndvcmtlckhhbmRvZmZzLmRlbGV0ZSh3b3JrZXIpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IFtqb2JJZCwgaGFuZG9mZklkXSBvZiBoYW5kb2Zmcykge1xuICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZUhhbmRvZmYoe2hhbmRvZmZJZCwgam9iSWQsIHdvcmtlcn0pXG4gICAgfVxuXG4gICAgdGhpcy53b3JrZXJIYW5kb2Zmcy5kZWxldGUod29ya2VyKVxuICAgIHRoaXMuX25vdGlmeUVucXVldWVkKClcbiAgICBpZiAocXVldWVSZWRyYWluKSB7XG4gICAgICB0aGlzLl9yZWRyYWluUXVldWVkID0gdHJ1ZVxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAodGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJhY3RpdmVcIikgYXdhaXQgdGhpcy5fZHJhaW4oKVxuICAgIH1cbiAgICB0aGlzLl9tYXliZVN0b3BSZXRpcmVkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9uZSBpZGVtcG90ZW50IGNvbmRpdGlvbmFsIGxlYXNlIHJlbGVhc2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuaGFuZG9mZklkIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy53b3JrZXIgLSBTb2NrZXQgdGhhdCByZWNlaXZlZCB0aGUgbGVhc2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSBmZW5jZWQgdHJhbnNpdGlvbi5cbiAgICovXG4gIGFzeW5jIF9yZWxlYXNlSGFuZG9mZih7aGFuZG9mZklkLCBqb2JJZCwgd29ya2VyfSkge1xuICAgIGF3YWl0IHRoaXMuc3RvcmUubWFya1JldHVybmVkVG9RdWV1ZSh7aGFuZG9mZklkLCBqb2JJZH0pXG5cbiAgICBjb25zdCBoYW5kb2ZmcyA9IHRoaXMud29ya2VySGFuZG9mZnMuZ2V0KHdvcmtlcilcblxuICAgIGlmIChoYW5kb2Zmcz8uZ2V0KGpvYklkKSA9PT0gaGFuZG9mZklkKSBoYW5kb2Zmcy5kZWxldGUoam9iSWQpXG4gIH1cblxuICAvKipcbiAgICogRm9yZ2V0cyBhIHN1Y2Nlc3NmdWxseSByZXBvcnRlZCBsZWFzZSB3aXRob3V0IHJlbHlpbmcgb24gd29ya2VyIGlkcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5oYW5kb2ZmSWQgLSBIYW5kb2ZmIGxlYXNlIGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfZm9yZ2V0SGFuZG9mZih7aGFuZG9mZklkLCBqb2JJZH0pIHtcbiAgICBmb3IgKGNvbnN0IFt3b3JrZXIsIGhhbmRvZmZzXSBvZiB0aGlzLndvcmtlckhhbmRvZmZzKSB7XG4gICAgICBpZiAoaGFuZG9mZnMuZ2V0KGpvYklkKSAhPT0gaGFuZG9mZklkKSBjb250aW51ZVxuXG4gICAgICBoYW5kb2Zmcy5kZWxldGUoam9iSWQpXG4gICAgICBpZiAoaGFuZG9mZnMuc2l6ZSA9PT0gMCAmJiAhdGhpcy53b3JrZXJzLmhhcyh3b3JrZXIpKSB0aGlzLndvcmtlckhhbmRvZmZzLmRlbGV0ZSh3b3JrZXIpXG4gICAgICBpZiAoaGFuZG9mZnMuc2l6ZSA9PT0gMCAmJiB3b3JrZXIud29ya2VySWQpIHtcbiAgICAgICAgY29uc3QgZGlzY29ubmVjdGVkID0gdGhpcy5kaXNjb25uZWN0ZWRXb3JrZXJzLmdldCh3b3JrZXIud29ya2VySWQpXG4gICAgICAgIGlmIChkaXNjb25uZWN0ZWQ/LndvcmtlciA9PT0gd29ya2VyKSB7XG4gICAgICAgICAgdGhpcy5jbG9jay5jbGVhclRpbWVvdXQoZGlzY29ubmVjdGVkLnRpbWVyKVxuICAgICAgICAgIHRoaXMuZGlzY29ubmVjdGVkV29ya2Vycy5kZWxldGUod29ya2VyLndvcmtlcklkKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICB0aGlzLl9tYXliZVN0b3BSZXRpcmVkKClcbiAgICAgIHJldHVyblxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBvcnRzIGFuIHVuZXhwZWN0ZWQgbGVhc2UtcmVsZWFzZSBmYWlsdXJlIG9uIGZyYW1ld29yayBlcnJvciBjaGFubmVscy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBSZWxlYXNlIGZhaWx1cmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlcG9ydEhhbmRvZmZSZWxlYXNlRXJyb3IoZXJyb3IpIHtcbiAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICBjb25zdCBwYXlsb2FkID0ge2NvbnRleHQ6IHtzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi1oYW5kb2ZmLXJlbGVhc2VcIn0sIGVycm9yOiBub3JtYWxpemVkRXJyb3J9XG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiRmFpbGVkIHRvIHJlbGVhc2UgZGlzY29ubmVjdGVkIHdvcmtlciBoYW5kb2ZmczpcIiwgbm9ybWFsaXplZEVycm9yXSlcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiZnJhbWV3b3JrLWVycm9yXCIsIHBheWxvYWQpXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4ucGF5bG9hZCwgZXJyb3JUeXBlOiBcImZyYW1ld29yay1lcnJvclwifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBvcnRzIGFuIHVuZXhwZWN0ZWQgd29ya2VyLWhhbmRvZmYgYWRvcHRpb24gZmFpbHVyZSBvbiBmcmFtZXdvcmsgZXJyb3JcbiAgICogY2hhbm5lbHMuIEEgZmFpbGVkIGFkb3B0aW9uIGlzIG5vdCBmYXRhbCAodGhlIHdvcmtlcidzIGpvYnMgcmVtYWluIGFuZCBhcmVcbiAgICogcmVjbGFpbWVkIGJ5IHRoZSBvcnBoYW4gc3dlZXApLCBidXQgbXVzdCBzdXJmYWNlIHJhdGhlciB0aGFuIGJlIHN3YWxsb3dlZC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBBZG9wdGlvbiBmYWlsdXJlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXBvcnRIYW5kb2ZmQWRvcHRFcnJvcihlcnJvcikge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKVxuICAgIGNvbnN0IHBheWxvYWQgPSB7Y29udGV4dDoge3N0YWdlOiBcImJhY2tncm91bmQtam9iLWhhbmRvZmYtYWRvcHRcIn0sIGVycm9yOiBub3JtYWxpemVkRXJyb3J9XG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiRmFpbGVkIHRvIGFkb3B0IHJlY29ubmVjdGVkIHdvcmtlciBoYW5kb2ZmczpcIiwgbm9ybWFsaXplZEVycm9yXSlcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiZnJhbWV3b3JrLWVycm9yXCIsIHBheWxvYWQpXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4ucGF5bG9hZCwgZXJyb3JUeXBlOiBcImZyYW1ld29yay1lcnJvclwifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBvcnRzIGFuIHVuZXhwZWN0ZWQgc3RhcnR1cC1zbmFwc2hvdCByZWNsYWltIGZhaWx1cmUgd2hpbGUgcmV0YWluaW5nIHRoZVxuICAgKiBzbmFwc2hvdCBmb3IgdGhlIGRpc3BhdGNoZXIncyBleGlzdGluZyB0cmFuc2llbnQtZXJyb3IgcmV0cnkgbGlmZWN5Y2xlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBlcnJvciAtIFJlY2xhaW0gZmFpbHVyZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVwb3J0U3RhcnR1cEhhbmRvZmZSZWNsYWltRXJyb3IoZXJyb3IpIHtcbiAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICBjb25zdCBwYXlsb2FkID0ge2NvbnRleHQ6IHtzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi1zdGFydHVwLWhhbmRvZmYtcmVjbGFpbVwifSwgZXJyb3I6IG5vcm1hbGl6ZWRFcnJvcn1cbiAgICBjb25zdCBlcnJvckV2ZW50cyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpXG5cbiAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJGYWlsZWQgdG8gcmVjbGFpbSBkaXNjb25uZWN0ZWQgc3RhcnR1cCBoYW5kb2ZmczpcIiwgbm9ybWFsaXplZEVycm9yXSlcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiZnJhbWV3b3JrLWVycm9yXCIsIHBheWxvYWQpXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4ucGF5bG9hZCwgZXJyb3JUeXBlOiBcImZyYW1ld29yay1lcnJvclwifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBlbnF1ZXVlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy5qc29uU29ja2V0IC0gSlNPTiBzb2NrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRW5xdWV1ZU1lc3NhZ2V9IGFyZ3MubWVzc2FnZSAtIE1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gaGFuZGxlZC5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVFbnF1ZXVlKHtqc29uU29ja2V0LCBtZXNzYWdlfSkge1xuICAgIHRyeSB7XG4gICAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWRcbiAgICAgICAgJiYgdHlwZW9mIG1lc3NhZ2UucHJvZHVjZXJQcm9vZj8ud29ya2VySWQgPT09IFwic3RyaW5nXCJcbiAgICAgICAgJiYgIXdvcmtlcklkQmVsb25nc1RvR2VuZXJhdGlvbih7Z2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZCwgd29ya2VySWQ6IG1lc3NhZ2UucHJvZHVjZXJQcm9vZi53b3JrZXJJZH0pKSB7XG4gICAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJCYWNrZ3JvdW5kIGpvYiBwcm9kdWNlciBoYW5kb2ZmIGJlbG9uZ3MgdG8gYW5vdGhlciBnZW5lcmF0aW9uLlwiLCB7XG4gICAgICAgICAgY29kZTogXCJiYWNrZ3JvdW5kLWpvYi1wcm9kdWNlci1nZW5lcmF0aW9uLW1pc21hdGNoXCJcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVxdWVzdCA9IHtcbiAgICAgICAgam9iTmFtZTogbWVzc2FnZS5qb2JOYW1lLFxuICAgICAgICBhcmdzOiBtZXNzYWdlLmFyZ3MgfHwgW10sXG4gICAgICAgIG9wdGlvbnM6IG1lc3NhZ2Uub3B0aW9ucyB8fCB7fVxuICAgICAgfVxuICAgICAgY29uc3Qgam9iSWQgPSB0aGlzLmdlbmVyYXRpb25JZCAmJiBtZXNzYWdlLnByb2R1Y2VyUHJvb2ZcbiAgICAgICAgPyBhd2FpdCB0aGlzLnN0b3JlLmVucXVldWVGcm9tT3duZWRIYW5kb2ZmKHsuLi5yZXF1ZXN0LCBwcm9kdWNlckludm9jYXRpb25JZDogbWVzc2FnZS5wcm9kdWNlckludm9jYXRpb25JZCwgcHJvZHVjZXJQcm9vZjogbWVzc2FnZS5wcm9kdWNlclByb29mfSlcbiAgICAgICAgOiBhd2FpdCB0aGlzLnN0b3JlLmVucXVldWUocmVxdWVzdClcblxuICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImVucXVldWVkXCIsIGpvYklkfSlcbiAgICAgIHRoaXMuX25vdGlmeUVucXVldWVkKClcbiAgICAgIGlmICh0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcImFjdGl2ZVwiKSBhd2FpdCB0aGlzLl9kcmFpbigpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuX2hhbmRsZUNsaWVudE11dGF0aW9uRXJyb3Ioe1xuICAgICAgICBjb250ZXh0OiB7am9iTmFtZTogbWVzc2FnZS5qb2JOYW1lLCBzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi1lbnF1ZXVlXCJ9LFxuICAgICAgICBlcnJvcixcbiAgICAgICAgZmFsbGJhY2tNZXNzYWdlOiBcIkZhaWxlZCB0byBlbnF1ZXVlIGpvYlwiLFxuICAgICAgICBqc29uU29ja2V0LFxuICAgICAgICBsb2dNZXNzYWdlOiBcIkZhaWxlZCB0byBlbnF1ZXVlIGJhY2tncm91bmQgam9iOlwiLFxuICAgICAgICByZXNwb25zZVR5cGU6IFwiZW5xdWV1ZS1lcnJvclwiXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGVzIGEgc3RhYmxlLWtleSByZXBsYWNlbWVudCByZXF1ZXN0IGFuZCByZS1hcm1zIGRpc3BhdGNoIGFmdGVyd2FyZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJlcGxhY2VTY2hlZHVsZWRNZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBNZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGhhbmRsZWQuXG4gICAqL1xuICBhc3luYyBfaGFuZGxlUmVwbGFjZVNjaGVkdWxlZCh7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5zdG9yZS5yZXBsYWNlU2NoZWR1bGVkKHtcbiAgICAgICAgc2NoZWR1bGVLZXk6IG1lc3NhZ2Uuc2NoZWR1bGVLZXksXG4gICAgICAgIGpvYk5hbWU6IG1lc3NhZ2Uuam9iTmFtZSxcbiAgICAgICAgYXJnczogbWVzc2FnZS5hcmdzIHx8IFtdLFxuICAgICAgICBvcHRpb25zOiBtZXNzYWdlLm9wdGlvbnMgfHwge31cbiAgICAgIH0pXG5cbiAgICAgIHRoaXMuX25vdGlmeUVucXVldWVkKClcbiAgICAgIGF3YWl0IHRoaXMuX2RyYWluKClcbiAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJzY2hlZHVsZS1yZXBsYWNlZFwiLCAuLi5yZXN1bHR9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLl9oYW5kbGVDbGllbnRNdXRhdGlvbkVycm9yKHtcbiAgICAgICAgY29udGV4dDoge2pvYk5hbWU6IG1lc3NhZ2Uuam9iTmFtZSwgc2NoZWR1bGVLZXk6IG1lc3NhZ2Uuc2NoZWR1bGVLZXksIHN0YWdlOiBcImJhY2tncm91bmQtam9iLXJlcGxhY2Utc2NoZWR1bGVkXCJ9LFxuICAgICAgICBlcnJvcixcbiAgICAgICAgZmFsbGJhY2tNZXNzYWdlOiBcIkZhaWxlZCB0byByZXBsYWNlIHNjaGVkdWxlZCBqb2JcIixcbiAgICAgICAganNvblNvY2tldCxcbiAgICAgICAgbG9nTWVzc2FnZTogXCJGYWlsZWQgdG8gcmVwbGFjZSBzY2hlZHVsZWQgYmFja2dyb3VuZCBqb2I6XCIsXG4gICAgICAgIHJlc3BvbnNlVHlwZTogXCJyZXBsYWNlLXNjaGVkdWxlZC1lcnJvclwiXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGVzIGEgc3RhYmxlLWtleSBjYW5jZWxsYXRpb24gcmVxdWVzdCBhbmQgcmUtYXJtcyBkaXNwYXRjaCBhZnRlcndhcmQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLmpzb25Tb2NrZXQgLSBKU09OIHNvY2tldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JDYW5jZWxTY2hlZHVsZWRNZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBNZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGhhbmRsZWQuXG4gICAqL1xuICBhc3luYyBfaGFuZGxlQ2FuY2VsU2NoZWR1bGVkKHtqc29uU29ja2V0LCBtZXNzYWdlfSkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnN0b3JlLmNhbmNlbFNjaGVkdWxlZChtZXNzYWdlLnNjaGVkdWxlS2V5KVxuXG4gICAgICB0aGlzLl9ub3RpZnlFbnF1ZXVlZCgpXG4gICAgICBhd2FpdCB0aGlzLl9kcmFpbigpXG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwic2NoZWR1bGUtY2FuY2VsbGVkXCIsIC4uLnJlc3VsdH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuX2hhbmRsZUNsaWVudE11dGF0aW9uRXJyb3Ioe1xuICAgICAgICBjb250ZXh0OiB7c2NoZWR1bGVLZXk6IG1lc3NhZ2Uuc2NoZWR1bGVLZXksIHN0YWdlOiBcImJhY2tncm91bmQtam9iLWNhbmNlbC1zY2hlZHVsZWRcIn0sXG4gICAgICAgIGVycm9yLFxuICAgICAgICBmYWxsYmFja01lc3NhZ2U6IFwiRmFpbGVkIHRvIGNhbmNlbCBzY2hlZHVsZWQgam9iXCIsXG4gICAgICAgIGpzb25Tb2NrZXQsXG4gICAgICAgIGxvZ01lc3NhZ2U6IFwiRmFpbGVkIHRvIGNhbmNlbCBzY2hlZHVsZWQgYmFja2dyb3VuZCBqb2I6XCIsXG4gICAgICAgIHJlc3BvbnNlVHlwZTogXCJjYW5jZWwtc2NoZWR1bGVkLWVycm9yXCJcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEhhbmRsZXMgYSBzdGFibGUgc2NoZWR1bGUgbG9va3VwIGFuZCByZXR1cm5zIG9ubHkgbm9ybWFsaXplZCBhZGFwdGVyIGpvYnMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLmpzb25Tb2NrZXQgLSBKU09OIHNvY2tldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JHZXRTY2hlZHVsZWRNZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBNZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGhhbmRsZWQuXG4gICAqL1xuICBhc3luYyBfaGFuZGxlR2V0U2NoZWR1bGVkSm9iKHtqc29uU29ja2V0LCBtZXNzYWdlfSkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnN0b3JlLmdldFNjaGVkdWxlZEpvYihtZXNzYWdlLnNjaGVkdWxlS2V5LCB7XG4gICAgICAgIGluY2x1ZGVMYXRlc3RUZXJtaW5hbDogbWVzc2FnZS5pbmNsdWRlTGF0ZXN0VGVybWluYWxcbiAgICAgIH0pXG5cbiAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJzY2hlZHVsZWQtam9iXCIsIC4uLnJlc3VsdH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuX2hhbmRsZUNsaWVudE11dGF0aW9uRXJyb3Ioe1xuICAgICAgICBjb250ZXh0OiB7c2NoZWR1bGVLZXk6IG1lc3NhZ2Uuc2NoZWR1bGVLZXksIHN0YWdlOiBcImJhY2tncm91bmQtam9iLWdldC1zY2hlZHVsZWRcIn0sXG4gICAgICAgIGVycm9yLFxuICAgICAgICBmYWxsYmFja01lc3NhZ2U6IFwiRmFpbGVkIHRvIHJlYWQgc2NoZWR1bGVkIGpvYlwiLFxuICAgICAgICBqc29uU29ja2V0LFxuICAgICAgICBsb2dNZXNzYWdlOiBcIkZhaWxlZCB0byByZWFkIHNjaGVkdWxlZCBiYWNrZ3JvdW5kIGpvYjpcIixcbiAgICAgICAgcmVzcG9uc2VUeXBlOiBcImdldC1zY2hlZHVsZWQtam9iLWVycm9yXCJcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEhhbmRsZXMgYSBzdGFibGUgc2NoZWR1bGUgd2FrZSBhbmQgcmUtYXJtcyBkaXNwYXRjaCBhZnRlciBpdHMgdHJhbnNhY3Rpb24gY29tbWl0cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYldha2VTY2hlZHVsZWRNZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBNZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGhhbmRsZWQuXG4gICAqL1xuICBhc3luYyBfaGFuZGxlV2FrZVNjaGVkdWxlZCh7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5zdG9yZS53YWtlU2NoZWR1bGVkKG1lc3NhZ2Uuc2NoZWR1bGVLZXkpXG5cbiAgICAgIGlmIChyZXN1bHQub3V0Y29tZSA9PT0gXCJ3b2tlblwiIHx8IHJlc3VsdC5vdXRjb21lID09PSBcImFscmVhZHlfZHVlXCIpIHtcbiAgICAgICAgdGhpcy5fbm90aWZ5RW5xdWV1ZWQoKVxuICAgICAgICBhd2FpdCB0aGlzLl9kcmFpbigpXG4gICAgICB9XG5cbiAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJzY2hlZHVsZS13b2tlblwiLCAuLi5yZXN1bHR9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLl9oYW5kbGVDbGllbnRNdXRhdGlvbkVycm9yKHtcbiAgICAgICAgY29udGV4dDoge3NjaGVkdWxlS2V5OiBtZXNzYWdlLnNjaGVkdWxlS2V5LCBzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi13YWtlLXNjaGVkdWxlZFwifSxcbiAgICAgICAgZXJyb3IsXG4gICAgICAgIGZhbGxiYWNrTWVzc2FnZTogXCJGYWlsZWQgdG8gd2FrZSBzY2hlZHVsZWQgam9iXCIsXG4gICAgICAgIGpzb25Tb2NrZXQsXG4gICAgICAgIGxvZ01lc3NhZ2U6IFwiRmFpbGVkIHRvIHdha2Ugc2NoZWR1bGVkIGJhY2tncm91bmQgam9iOlwiLFxuICAgICAgICByZXNwb25zZVR5cGU6IFwid2FrZS1zY2hlZHVsZWQtZXJyb3JcIlxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBzYWZlIHZhbGlkYXRpb24gZmFpbHVyZXMgYW5kIHJlcG9ydHMgdW5leHBlY3RlZCBjbGllbnQgbXV0YXRpb25zLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmNvbnRleHQgLSBGcmFtZXdvcmstZXJyb3IgY29udGV4dC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIE11dGF0aW9uIGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmZhbGxiYWNrTWVzc2FnZSAtIENsaWVudC1zYWZlIGZhbGxiYWNrIG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy5qc29uU29ja2V0IC0gSlNPTiBzb2NrZXQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmxvZ01lc3NhZ2UgLSBFcnJvciBsb2cgcHJlZml4LlxuICAgKiBAcGFyYW0ge1wiZW5xdWV1ZS1lcnJvclwiIHwgXCJyZXBsYWNlLXNjaGVkdWxlZC1lcnJvclwiIHwgXCJjYW5jZWwtc2NoZWR1bGVkLWVycm9yXCIgfCBcImdldC1zY2hlZHVsZWQtam9iLWVycm9yXCIgfCBcIndha2Utc2NoZWR1bGVkLWVycm9yXCJ9IGFyZ3MucmVzcG9uc2VUeXBlIC0gUmVzcG9uc2UgdHlwZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaGFuZGxlQ2xpZW50TXV0YXRpb25FcnJvcih7Y29udGV4dCwgZXJyb3IsIGZhbGxiYWNrTWVzc2FnZSwganNvblNvY2tldCwgbG9nTWVzc2FnZSwgcmVzcG9uc2VUeXBlfSkge1xuICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIFZlbG9jaW91c0Vycm9yICYmIGVycm9yLnNhZmVUb0V4cG9zZSkge1xuICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiByZXNwb25zZVR5cGUsIGVycm9yOiBlcnJvci5tZXNzYWdlfSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKVxuICAgIGNvbnN0IHBheWxvYWQgPSB7Y29udGV4dCwgZXJyb3I6IG5vcm1hbGl6ZWRFcnJvcn1cbiAgICBjb25zdCBlcnJvckV2ZW50cyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpXG5cbiAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbbG9nTWVzc2FnZSwgbm9ybWFsaXplZEVycm9yXSlcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiZnJhbWV3b3JrLWVycm9yXCIsIHBheWxvYWQpXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4ucGF5bG9hZCwgZXJyb3JUeXBlOiBcImZyYW1ld29yay1lcnJvclwifSlcbiAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IHJlc3BvbnNlVHlwZSwgZXJyb3I6IGZhbGxiYWNrTWVzc2FnZX0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgam9iIGNvbXBsZXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy5qc29uU29ja2V0IC0gSlNPTiBzb2NrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iQ29tcGxldGVNZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBNZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGhhbmRsZWQuXG4gICAqL1xuICBhc3luYyBfaGFuZGxlSm9iQ29tcGxldGUoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGFjY2VwdGVkID0gYXdhaXQgdGhpcy5zdG9yZS5tYXJrQ29tcGxldGVkKHtcbiAgICAgICAgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsXG4gICAgICAgIGhhbmRvZmZJZDogbWVzc2FnZS5oYW5kb2ZmSWQsXG4gICAgICAgIHdvcmtlcklkOiBtZXNzYWdlLndvcmtlcklkLFxuICAgICAgICBoYW5kZWRPZmZBdE1zOiBtZXNzYWdlLmhhbmRlZE9mZkF0TXNcbiAgICAgIH0pXG4gICAgICBpZiAoYWNjZXB0ZWQgJiYgbWVzc2FnZS5oYW5kb2ZmSWQpIHtcbiAgICAgICAgdGhpcy5fZm9yZ2V0SGFuZG9mZih7aGFuZG9mZklkOiBtZXNzYWdlLmhhbmRvZmZJZCwgam9iSWQ6IG1lc3NhZ2Uuam9iSWR9KVxuICAgICAgfVxuICAgICAgdGhpcy5vbkpvYlVwZGF0ZWQ/Lih7YWNjZXB0ZWQsIGpvYklkOiBtZXNzYWdlLmpvYklkLCBzdGF0dXM6IFwiY29tcGxldGVkXCJ9KVxuICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImpvYi11cGRhdGVkXCIsIGpvYklkOiBtZXNzYWdlLmpvYklkfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5fcmVwb3J0Sm9iVXBkYXRlRmFpbHVyZSh7ZXJyb3IsIGpvYklkOiBtZXNzYWdlLmpvYklkLCBzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi1jb21wbGV0ZVwifSlcbiAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJqb2ItdXBkYXRlLWVycm9yXCIsIGpvYklkOiBtZXNzYWdlLmpvYklkLCBlcnJvcjogXCJGYWlsZWQgdG8gdXBkYXRlIGpvYlwifSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU3VyZmFjZXMgYW4gdW5leHBlY3RlZCBkdXJhYmxlIHJlcG9ydCBmYWlsdXJlIHdpdGhvdXQgZXhwb3NpbmcgaXQgdG8gdGhlXG4gICAqIHJlcG9ydGluZyBwZWVyLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEZhaWx1cmUgY29udGV4dC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIEFkYXB0ZXIgZmFpbHVyZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBEdXJhYmxlIGpvYiBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc3RhZ2UgLSBNdXRhdGlvbiBzdGFnZS5cbiAgICovXG4gIF9yZXBvcnRKb2JVcGRhdGVGYWlsdXJlKHtlcnJvciwgam9iSWQsIHN0YWdlfSkge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKVxuICAgIGNvbnN0IHBheWxvYWQgPSB7Y29udGV4dDoge2dlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWQsIGpvYklkLCBzdGFnZX0sIGVycm9yOiBub3JtYWxpemVkRXJyb3J9XG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiRmFpbGVkIHRvIHVwZGF0ZSBiYWNrZ3JvdW5kIGpvYjpcIiwgbm9ybWFsaXplZEVycm9yXSlcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiZnJhbWV3b3JrLWVycm9yXCIsIHBheWxvYWQpXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4ucGF5bG9hZCwgZXJyb3JUeXBlOiBcImZyYW1ld29yay1lcnJvclwifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJzaXN0cyBhIG5vcm1hbCBqb2IgcmVzY2hlZHVsZSBvdXRjb21lIGFuZCB3YWtlcyBzY2hlZHVsZWQgZGlzcGF0Y2guXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLmpzb25Tb2NrZXQgLSBKU09OIHNvY2tldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSZXNjaGVkdWxlTWVzc2FnZX0gYXJncy5tZXNzYWdlIC0gTWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBoYW5kbGVkLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZUpvYlJlc2NoZWR1bGUoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGFjY2VwdGVkID0gYXdhaXQgdGhpcy5zdG9yZS5tYXJrUmVzY2hlZHVsZWQoe1xuICAgICAgICBqb2JJZDogbWVzc2FnZS5qb2JJZCxcbiAgICAgICAgZGVsYXlNczogbWVzc2FnZS5kZWxheU1zLFxuICAgICAgICBoYW5kb2ZmSWQ6IG1lc3NhZ2UuaGFuZG9mZklkLFxuICAgICAgICB3b3JrZXJJZDogbWVzc2FnZS53b3JrZXJJZCxcbiAgICAgICAgaGFuZGVkT2ZmQXRNczogbWVzc2FnZS5oYW5kZWRPZmZBdE1zXG4gICAgICB9KVxuICAgICAgaWYgKGFjY2VwdGVkICYmIG1lc3NhZ2UuaGFuZG9mZklkKSB7XG4gICAgICAgIHRoaXMuX2ZvcmdldEhhbmRvZmYoe2hhbmRvZmZJZDogbWVzc2FnZS5oYW5kb2ZmSWQsIGpvYklkOiBtZXNzYWdlLmpvYklkfSlcbiAgICAgIH1cbiAgICAgIHRoaXMub25Kb2JVcGRhdGVkPy4oe2FjY2VwdGVkLCBqb2JJZDogbWVzc2FnZS5qb2JJZCwgc3RhdHVzOiBcInJlc2NoZWR1bGVkXCJ9KVxuICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImpvYi11cGRhdGVkXCIsIGpvYklkOiBtZXNzYWdlLmpvYklkfSlcbiAgICAgIHRoaXMuX25vdGlmeUVucXVldWVkKClcbiAgICAgIGF3YWl0IHRoaXMuX2RyYWluKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG4gICAgICBjb25zdCBwYXlsb2FkID0ge2NvbnRleHQ6IHtqb2JJZDogbWVzc2FnZS5qb2JJZCwgc3RhZ2U6IFwiYmFja2dyb3VuZC1qb2ItcmVzY2hlZHVsZVwifSwgZXJyb3I6IG5vcm1hbGl6ZWRFcnJvcn1cbiAgICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiRmFpbGVkIHRvIHVwZGF0ZSBqb2IgcmVzY2hlZHVsZTpcIiwgbm9ybWFsaXplZEVycm9yXSlcbiAgICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiam9iLXVwZGF0ZS1lcnJvclwiLCBqb2JJZDogbWVzc2FnZS5qb2JJZCwgZXJyb3I6IFwiRmFpbGVkIHRvIHVwZGF0ZSBqb2JcIn0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIGpvYiBmYWlsZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLmpzb25Tb2NrZXQgLSBKU09OIHNvY2tldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JGYWlsZWRNZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBNZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGhhbmRsZWQuXG4gICAqL1xuICBhc3luYyBfaGFuZGxlSm9iRmFpbGVkKHtqc29uU29ja2V0LCBtZXNzYWdlfSkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBmYWlsZWRKb2IgPSBhd2FpdCB0aGlzLnN0b3JlLm1hcmtGYWlsZWQoe1xuICAgICAgICBqb2JJZDogbWVzc2FnZS5qb2JJZCxcbiAgICAgICAgZXJyb3I6IG1lc3NhZ2UuZXJyb3IsXG4gICAgICAgIGhhbmRvZmZJZDogbWVzc2FnZS5oYW5kb2ZmSWQsXG4gICAgICAgIHdvcmtlcklkOiBtZXNzYWdlLndvcmtlcklkLFxuICAgICAgICBoYW5kZWRPZmZBdE1zOiBtZXNzYWdlLmhhbmRlZE9mZkF0TXNcbiAgICAgIH0pXG5cbiAgICAgIGlmIChmYWlsZWRKb2IpIHtcbiAgICAgICAgaWYgKG1lc3NhZ2UuaGFuZG9mZklkKSB7XG4gICAgICAgICAgdGhpcy5fZm9yZ2V0SGFuZG9mZih7aGFuZG9mZklkOiBtZXNzYWdlLmhhbmRvZmZJZCwgam9iSWQ6IG1lc3NhZ2Uuam9iSWR9KVxuICAgICAgICB9XG4gICAgICAgIHRoaXMuX2VtaXRCYWNrZ3JvdW5kSm9iRmFpbGVkKHtcbiAgICAgICAgICBlcnJvcjogbWVzc2FnZS5lcnJvcixcbiAgICAgICAgICBoYW5kb2ZmSWQ6IG1lc3NhZ2UuaGFuZG9mZklkLFxuICAgICAgICAgIGhhbmRlZE9mZkF0TXM6IG1lc3NhZ2UuaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgICBqb2I6IGZhaWxlZEpvYixcbiAgICAgICAgICBydW5uZXJGYWlsdXJlOiBtZXNzYWdlLnJ1bm5lckZhaWx1cmUsXG4gICAgICAgICAgd29ya2VySWQ6IG1lc3NhZ2Uud29ya2VySWRcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgdGhpcy5vbkpvYlVwZGF0ZWQ/Lih7YWNjZXB0ZWQ6IEJvb2xlYW4oZmFpbGVkSm9iKSwgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsIHN0YXR1czogXCJmYWlsZWRcIn0pXG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiam9iLXVwZGF0ZWRcIiwgam9iSWQ6IG1lc3NhZ2Uuam9iSWR9KVxuICAgICAgLy8gQSBmYWlsZWQgam9iIG1heSBoYXZlIGJlZW4gcmUtcXVldWVkICh3aXRoIGJhY2tvZmYpIGZvciByZXRyeSDigJRcbiAgICAgIC8vIHBva2UgdGhlIGRpc3BhdGNoZXIgc28gdGhlIHJldHJ5IHRpbWVyIGlzIGFybWVkLlxuICAgICAgdGhpcy5fbm90aWZ5RW5xdWV1ZWQoKVxuICAgICAgYXdhaXQgdGhpcy5fZHJhaW4oKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJGYWlsZWQgdG8gdXBkYXRlIGpvYiBmYWlsdXJlOlwiLCBlcnJvcl0pXG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiam9iLXVwZGF0ZS1lcnJvclwiLCBqb2JJZDogbWVzc2FnZS5qb2JJZCwgZXJyb3I6IFwiRmFpbGVkIHRvIHVwZGF0ZSBqb2JcIn0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW1pdCBiYWNrZ3JvdW5kIGpvYiBmYWlsZWQuXG4gICAqIEBwYXJhbSB7e2Vycm9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgaGFuZG9mZklkPzogc3RyaW5nLCBoYW5kZWRPZmZBdE1zPzogbnVtYmVyLCBqb2I6IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdywgcnVubmVyRmFpbHVyZT86IGltcG9ydChcIi4vdHlwZXMuanNcIikuUG9vbGVkUnVubmVyRmFpbHVyZSwgd29ya2VySWQ/OiBzdHJpbmd9fSBhcmdzIC0gRmFpbHVyZSBldmVudCBkYXRhLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9lbWl0QmFja2dyb3VuZEpvYkZhaWxlZCh7ZXJyb3IsIGhhbmRvZmZJZCwgaGFuZGVkT2ZmQXRNcywgam9iLCBydW5uZXJGYWlsdXJlLCB3b3JrZXJJZH0pIHtcbiAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSB0aGlzLl9ub3JtYWxpemVGYWlsdXJlRXJyb3IoZXJyb3IpXG4gICAgY29uc3QgcGF5bG9hZCA9IHtcbiAgICAgIGNvbnRleHQ6IHtcbiAgICAgICAgYXR0ZW1wdHM6IGpvYi5hdHRlbXB0cyxcbiAgICAgICAgaGFuZG9mZklkLFxuICAgICAgICBoYW5kZWRPZmZBdE1zLFxuICAgICAgICBqb2JBcmdzOiBqb2IuYXJncyxcbiAgICAgICAgam9iSWQ6IGpvYi5pZCxcbiAgICAgICAgam9iTmFtZTogam9iLmpvYk5hbWUsXG4gICAgICAgIG1heFJldHJpZXM6IGpvYi5tYXhSZXRyaWVzLFxuICAgICAgICBydW5uZXJGYWlsdXJlLFxuICAgICAgICBzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi1mYWlsZWRcIixcbiAgICAgICAgc3RhdHVzOiBqb2Iuc3RhdHVzLFxuICAgICAgICB0ZXJtaW5hbDogam9iLnN0YXR1cyA9PT0gXCJmYWlsZWRcIiB8fCBqb2Iuc3RhdHVzID09PSBcIm9ycGhhbmVkXCIsXG4gICAgICAgIHdpbGxSZXRyeTogam9iLnN0YXR1cyA9PT0gXCJxdWV1ZWRcIixcbiAgICAgICAgd29ya2VySWRcbiAgICAgIH0sXG4gICAgICBlcnJvcjogbm9ybWFsaXplZEVycm9yXG4gICAgfVxuICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJiYWNrZ3JvdW5kLWpvYi1mYWlsZWRcIiwgcGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiYmFja2dyb3VuZC1qb2ItZmFpbGVkXCJ9KVxuICB9XG5cbiAgLyoqXG4gICAqIEVtaXRzIGBiYWNrZ3JvdW5kLWpvYi1vcnBoYW5lZGAgKG1pcnJvcmVkIHRvIGBhbGwtZXJyb3JgKSBmb3IgYSBqb2IgdGhlIHRpbWUtYmFzZWQgb3JwaGFuIHN3ZWVwXG4gICAqIHJlY2xhaW1lZCBhZnRlciBpdHMgd29ya2VyIGRpZWQgbWlkLXJ1bi4gVW5saWtlIGBiYWNrZ3JvdW5kLWpvYi1mYWlsZWRgLCB3aGljaCBmaXJlcyBvbiBhXG4gICAqIHdvcmtlcidzIGZhaWx1cmUgcmVwb3J0LCB0aGlzIGZpcmVzIGZyb20gdGhlIG1haW4gcHJvY2VzcydzIHN3ZWVwLCBzbyBhcHBsaWNhdGlvbnMgY2FuIHJlYWN0IHRvXG4gICAqIGEgZGVhZCB3b3JrZXIncyBzcGVjaWZpYyBqb2Ig4oCUIHJlY292ZXIgdGhlIHdvcmsgaXQgbGVmdCBiZWhpbmQg4oCUIHdpdGhvdXQgcG9sbGluZy4gYHdpbGxSZXRyeWBcbiAgICogcmVmbGVjdHMgd2hldGhlciB0aGUgcmVjbGFpbSByZXR1cm5lZCB0aGUgam9iIHRvIHRoZSBxdWV1ZSBmb3IgYW5vdGhlciBhdHRlbXB0LlxuICAgKiBAcGFyYW0ge3tqb2I6IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd319IGFyZ3MgLSBUaGUgb3JwaGFuZWQgam9iLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9lbWl0QmFja2dyb3VuZEpvYk9ycGhhbmVkKHtqb2J9KSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gdGhpcy5fbm9ybWFsaXplRmFpbHVyZUVycm9yKGpvYi5sYXN0RXJyb3IgPz8gXCJKb2Igb3JwaGFuZWQgYWZ0ZXIgdGltZW91dFwiKVxuICAgIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgICBjb250ZXh0OiB7XG4gICAgICAgIGF0dGVtcHRzOiBqb2IuYXR0ZW1wdHMsXG4gICAgICAgIGpvYkFyZ3M6IGpvYi5hcmdzLFxuICAgICAgICBqb2JJZDogam9iLmlkLFxuICAgICAgICBqb2JOYW1lOiBqb2Iuam9iTmFtZSxcbiAgICAgICAgbWF4UmV0cmllczogam9iLm1heFJldHJpZXMsXG4gICAgICAgIHN0YWdlOiBcImJhY2tncm91bmQtam9iLW9ycGhhbmVkXCIsXG4gICAgICAgIHN0YXR1czogam9iLnN0YXR1cyxcbiAgICAgICAgdGVybWluYWw6IGpvYi5zdGF0dXMgPT09IFwiZmFpbGVkXCIgfHwgam9iLnN0YXR1cyA9PT0gXCJvcnBoYW5lZFwiLFxuICAgICAgICB3aWxsUmV0cnk6IGpvYi5zdGF0dXMgPT09IFwicXVldWVkXCJcbiAgICAgIH0sXG4gICAgICBlcnJvcjogbm9ybWFsaXplZEVycm9yXG4gICAgfVxuICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJiYWNrZ3JvdW5kLWpvYi1vcnBoYW5lZFwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJiYWNrZ3JvdW5kLWpvYi1vcnBoYW5lZFwifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBmYWlsdXJlIGVycm9yLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBlcnJvciAtIFJlcG9ydGVkIGZhaWx1cmUgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtFcnJvcn0gTm9ybWFsaXplZCBlcnJvci5cbiAgICovXG4gIF9ub3JtYWxpemVGYWlsdXJlRXJyb3IoZXJyb3IpIHtcbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikgcmV0dXJuIGVycm9yXG5cbiAgICByZXR1cm4gdGhpcy5fZXJyb3JGcm9tVW5rbm93bkZhaWx1cmUoZXJyb3IpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlcnJvciBmcm9tIHVua25vd24gZmFpbHVyZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBSZXBvcnRlZCBmYWlsdXJlIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7RXJyb3J9IE5vcm1hbGl6ZWQgZXJyb3IuXG4gICAqL1xuICBfZXJyb3JGcm9tVW5rbm93bkZhaWx1cmUoZXJyb3IpIHtcbiAgICBjb25zdCBtZXNzYWdlID0gdGhpcy5fbWVzc2FnZUZyb21Vbmtub3duRmFpbHVyZShlcnJvcilcbiAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBuZXcgRXJyb3IobWVzc2FnZSlcblxuICAgIHRoaXMuX2NvcHlTdHJpbmdGYWlsdXJlU3RhY2soe2Vycm9yLCBub3JtYWxpemVkRXJyb3J9KVxuXG4gICAgcmV0dXJuIG5vcm1hbGl6ZWRFcnJvclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWVzc2FnZSBmcm9tIHVua25vd24gZmFpbHVyZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBSZXBvcnRlZCBmYWlsdXJlIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBFcnJvciBtZXNzYWdlLlxuICAgKi9cbiAgX21lc3NhZ2VGcm9tVW5rbm93bkZhaWx1cmUoZXJyb3IpIHtcbiAgICBpZiAodGhpcy5faGFzU3RyaW5nRmFpbHVyZShlcnJvcikpIHJldHVybiBlcnJvci50cmltKCkuc3BsaXQoXCJcXG5cIilbMF1cblxuICAgIHJldHVybiBTdHJpbmcoZXJyb3IgfHwgXCJCYWNrZ3JvdW5kIGpvYiBmYWlsZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhcyBzdHJpbmcgZmFpbHVyZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBSZXBvcnRlZCBmYWlsdXJlIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7ZXJyb3IgaXMgc3RyaW5nfSBXaGV0aGVyIHRoZSB2YWx1ZSBpcyBhIG5vbi1lbXB0eSBzdHJpbmcuXG4gICAqL1xuICBfaGFzU3RyaW5nRmFpbHVyZShlcnJvcikge1xuICAgIHJldHVybiB0eXBlb2YgZXJyb3IgPT09IFwic3RyaW5nXCIgJiYgZXJyb3IudHJpbSgpLmxlbmd0aCA+IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvcHkgc3RyaW5nIGZhaWx1cmUgc3RhY2suXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIFJlcG9ydGVkIGZhaWx1cmUgdmFsdWUuXG4gICAqIEBwYXJhbSB7RXJyb3J9IGFyZ3Mubm9ybWFsaXplZEVycm9yIC0gTm9ybWFsaXplZCBlcnJvci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfY29weVN0cmluZ0ZhaWx1cmVTdGFjayh7ZXJyb3IsIG5vcm1hbGl6ZWRFcnJvcn0pIHtcbiAgICBpZiAodGhpcy5faGFzU3RyaW5nRmFpbHVyZShlcnJvcikpIG5vcm1hbGl6ZWRFcnJvci5zdGFjayA9IGVycm9yXG4gIH1cblxuICAvKipcbiAgICogRHJhaW5zIGFsbCBkaXNwYXRjaGFibGUgam9icyB0byByZWFkeSB3b3JrZXJzLCB0aGVuIGFybXMgdGhlXG4gICAqIHNjaGVkdWxlZC1qb2IgdGltZXIgZm9yIHRoZSBuZXh0IGZ1dHVyZSBgc2NoZWR1bGVkX2F0X21zYC4gQ29hbGVzY2VzXG4gICAqIGNvbmN1cnJlbnQgdHJpZ2dlcnM6IGEgd2FrZS11cCB0aGF0IGxhbmRzIHdoaWxlIGEgZHJhaW4gaXMgaW5cbiAgICogZmxpZ2h0IGp1c3Qgc2V0cyBhIHJlLWRyYWluIGZsYWcgYW5kIGxldHMgdGhlIGluLWZsaWdodCBkcmFpblxuICAgKiByZS1sb29wIGFmdGVyIGl0IGZpbmlzaGVzLCBzbyBubyBzaWduYWwgaXMgZHJvcHBlZCBidXQgbm8gdHdvXG4gICAqIGRyYWlucyBydW4gaW4gcGFyYWxsZWwuXG4gICAqXG4gICAqIFJlc2lsaWVuY2U6IGluIGJlYWNvbiBtb2RlIHRoaXMgaXMgdGhlIHNvbGUgd2FrZS11cCBwYXRoIGZvclxuICAgKiBhbHJlYWR5LXF1ZXVlZCB3b3JrLCBzbyBhIHRyYW5zaWVudCBEQiBlcnJvciBkdXJpbmcgdGhlIGRyYWluIChlLmcuXG4gICAqIGBuZXh0QXZhaWxhYmxlSm9iKClgIHJlamVjdGluZykgbXVzdCBub3Qgc3RyYW5kIHRoZSBxdWV1ZSB1bnRpbCB0aGVcbiAgICogbmV4dCBleHRlcm5hbCBzaWduYWwuIE9uIGFueSBlcnJvciB3ZSBsb2cgaXQgYW5kIGFybSBhIG9uZS1zaG90XG4gICAqIHJldHJ5IHZpYSBgX3NjaGVkdWxlRXJyb3JSZXRyeWAgdXNpbmcgYHBvbGxJbnRlcnZhbE1zYCBhcyB0aGVcbiAgICogY2FkZW5jZTsgb24gc3VjY2VzcyB0aGUgcmV0cnkgdGltZXIgaXMgY2xlYXJlZC4gUG9sbGluZy1tb2RlIHJ1bnNcbiAgICogYF9kcmFpbmAgZnJvbSBpdHMgb3duIGludGVydmFsLCBzbyB0aGUgcmV0cnkgdGltZXIgaXMgYSBuby1vcCB0aGVyZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfZHJhaW4oKSB7XG4gICAgaWYgKHRoaXMuX3N0b3BwZWQgfHwgdGhpcy5saWZlY3ljbGVTdGF0ZSAhPT0gXCJhY3RpdmVcIiB8fCAhdGhpcy5fYWN0aXZlT3duZXJzaGlwUmVhZHkpIHJldHVyblxuXG4gICAgaWYgKHRoaXMuX2RyYWluUHJvbWlzZSkge1xuICAgICAgdGhpcy5fcmVkcmFpblF1ZXVlZCA9IHRydWVcbiAgICAgIGF3YWl0IHRoaXMuX2RyYWluUHJvbWlzZVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgZHJhaW5Qcm9taXNlID0gdGhpcy5fZHJhaW5Ub0NvbXBsZXRpb24oKVxuXG4gICAgdGhpcy5fZHJhaW5Qcm9taXNlID0gZHJhaW5Qcm9taXNlXG4gICAgYXdhaXQgZHJhaW5Qcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBvbmUgc2VyaWFsaXplZCBkcmFpbiBsaWZlY3ljbGUsIGluY2x1ZGluZyB0aW1lciByZS1hcm1pbmcuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGV2ZXJ5IGNvYWxlc2NlZCByZXF1ZXN0IGlzIGhhbmRsZWQuXG4gICAqL1xuICBhc3luYyBfZHJhaW5Ub0NvbXBsZXRpb24oKSB7XG4gICAgdGhpcy5fZHJhaW5pbmcgPSB0cnVlXG5cbiAgICB0cnkge1xuICAgICAgbGV0IGVycm9yZWRcblxuICAgICAgZG8ge1xuICAgICAgICBlcnJvcmVkID0gYXdhaXQgdGhpcy5fZHJhaW5VbnRpbElkbGUoKVxuICAgICAgICBhd2FpdCB0aGlzLl9maW5pc2hEcmFpbih7ZXJyb3JlZH0pXG4gICAgICB9IHdoaWxlICghZXJyb3JlZCAmJiB0aGlzLl9yZWRyYWluUXVldWVkICYmICF0aGlzLl9zdG9wcGVkICYmIHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwiYWN0aXZlXCIpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX2RyYWluaW5nID0gZmFsc2VcbiAgICAgIHRoaXMuX2RyYWluUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmlzaCBkcmFpbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MuZXJyb3JlZCAtIFdoZXRoZXIgdGhlIGRyYWluIGhpdCBhbiBlcnJvci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZm9sbG93LXVwIHRpbWVycyBhcmUgaGFuZGxlZC5cbiAgICovXG4gIGFzeW5jIF9maW5pc2hEcmFpbih7ZXJyb3JlZH0pIHtcbiAgICBpZiAodGhpcy5fc3RvcHBlZCB8fCB0aGlzLmxpZmVjeWNsZVN0YXRlICE9PSBcImFjdGl2ZVwiKSByZXR1cm5cbiAgICBpZiAoZXJyb3JlZCkgcmV0dXJuIHRoaXMuX3NjaGVkdWxlRXJyb3JSZXRyeSgpXG5cbiAgICBhd2FpdCB0aGlzLl9hcm1TY2hlZHVsZWRUaW1lck9yUmV0cnkoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXJtIHNjaGVkdWxlZCB0aW1lciBvciByZXRyeS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgc2NoZWR1bGVkIHRpbWVyIGhhbmRsaW5nLlxuICAgKi9cbiAgYXN5bmMgX2FybVNjaGVkdWxlZFRpbWVyT3JSZXRyeSgpIHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fYXJtU2NoZWR1bGVkVGltZXIoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJCYWNrZ3JvdW5kIGpvYnMgc2NoZWR1bGVkLXRpbWVyIGFybWluZyBmYWlsZWQ6XCIsIGVycm9yXSlcbiAgICAgIHRoaXMuX3NjaGVkdWxlRXJyb3JSZXRyeSgpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9jbGVhckVycm9yUmV0cnlUaW1lcigpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGVhciBlcnJvciByZXRyeSB0aW1lci5cbiAgICogQHJldHVybnMge3ZvaWR9ICovXG4gIF9jbGVhckVycm9yUmV0cnlUaW1lcigpIHtcbiAgICBpZiAodGhpcy5wZW5kaW5nSGFuZG9mZlJlY292ZXJpZXMuc2l6ZSA+IDApIHJldHVyblxuICAgIGlmICh0aGlzLl9zdGFydHVwSGFuZG9mZkdyYWNlRWxhcHNlZCAmJiB0aGlzLnN0YXJ0dXBIYW5kb2ZmU25hcHNob3QubGVuZ3RoID4gMCkgcmV0dXJuXG5cbiAgICBmb3IgKGNvbnN0IHdvcmtlciBvZiB0aGlzLndvcmtlckhhbmRvZmZzLmtleXMoKSkge1xuICAgICAgaWYgKCF0aGlzLndvcmtlcnMuaGFzKHdvcmtlcikpIHJldHVyblxuICAgIH1cblxuICAgIGlmICh0aGlzLl9lcnJvclJldHJ5VGltZXIpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLl9lcnJvclJldHJ5VGltZXIpXG4gICAgICB0aGlzLl9lcnJvclJldHJ5VGltZXIgPSB1bmRlZmluZWRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBkcmFpbiB1bnRpbCBpZGxlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBkcmFpbiBoaXQgYW4gZXJyb3IuXG4gICAqL1xuICBhc3luYyBfZHJhaW5VbnRpbElkbGUoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3J1bkRyYWluTG9vcCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gZHJhaW4gbG9vcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgZHJhaW4gaGl0IGFuIGVycm9yLlxuICAgKi9cbiAgYXN5bmMgX3J1bkRyYWluTG9vcCgpIHtcbiAgICBkbyB7XG4gICAgICB0aGlzLl9yZWRyYWluUXVldWVkID0gZmFsc2VcbiAgICAgIGNvbnN0IGVycm9yZWQgPSBhd2FpdCB0aGlzLl9kcmFpbk9uY2VXaXRoRXJyb3JSZXBvcnQoKVxuXG4gICAgICBpZiAoZXJyb3JlZCkgcmV0dXJuIHRydWVcbiAgICB9IHdoaWxlICh0aGlzLl9yZWRyYWluUXVldWVkICYmICF0aGlzLl9zdG9wcGVkKVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkcmFpbiBvbmNlIHdpdGggZXJyb3IgcmVwb3J0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIG9uZSBkcmFpbiBwYXNzIGZhaWxlZC5cbiAgICovXG4gIGFzeW5jIF9kcmFpbk9uY2VXaXRoRXJyb3JSZXBvcnQoKSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX2RyYWluT25jZSgpXG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiQmFja2dyb3VuZCBqb2JzIGRyYWluIGZhaWxlZDpcIiwgZXJyb3JdKVxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQXJtcyBhIG9uZS1zaG90IGBzZXRUaW1lb3V0YCB0byByZXRyeSBgX2RyYWluYCBhZnRlciBhIHRyYW5zaWVudFxuICAgKiBmYWlsdXJlLiBJZGVtcG90ZW50IOKAlCByZXBlYXRlZCBjYWxscyB3aGlsZSBhIHJldHJ5IGlzIGFscmVhZHlcbiAgICogcGVuZGluZyBhcmUgbm8tb3BzLiBQb2xsaW5nIG1vZGUgYWxyZWFkeSByZXRyaWVzIHZpYSBpdHMgb3duXG4gICAqIGludGVydmFsLCBzbyB0aGlzIGlzIGEgbm8tb3AgaW4gdGhhdCBtb2RlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zY2hlZHVsZUVycm9yUmV0cnkoKSB7XG4gICAgaWYgKHRoaXMuX3N0b3BwZWQpIHJldHVyblxuICAgIGlmICh0aGlzLl9lcnJvclJldHJ5VGltZXIpIHJldHVyblxuICAgIGlmICh0aGlzLmRpc3BhdGNoU3RyYXRlZ3kgPT09IFwicG9sbGluZ1wiICYmIHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwiYWN0aXZlXCIpIHJldHVyblxuXG4gICAgdGhpcy5fZXJyb3JSZXRyeVRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0aGlzLl9lcnJvclJldHJ5VGltZXIgPSB1bmRlZmluZWRcbiAgICAgIHZvaWQgdGhpcy5fcmV0cnlBZnRlckVycm9yKClcbiAgICB9LCB0aGlzLnBvbGxJbnRlcnZhbE1zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHJpZXMgZmFpbGVkIHByZS1kaXNwYXRjaCBhbmQgZGlzY29ubmVjdGVkLXNvY2tldCByZWxlYXNlcyBiZWZvcmVcbiAgICogZHJhaW5pbmcgcXVldWVkIHdvcmsuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHJldHJ5IHdvcmsuXG4gICAqL1xuICBhc3luYyBfcmV0cnlBZnRlckVycm9yKCkge1xuICAgIGlmICh0aGlzLl9zdG9wcGVkKSByZXR1cm5cblxuICAgIGlmICh0aGlzLl9zdGFydHVwSGFuZG9mZkdyYWNlRWxhcHNlZCAmJiB0aGlzLnN0YXJ0dXBIYW5kb2ZmU25hcHNob3QubGVuZ3RoID4gMCkge1xuICAgICAgYXdhaXQgdGhpcy5fc3RhcnRTdGFydHVwSGFuZG9mZlJlY2xhaW0oKVxuICAgICAgaWYgKHRoaXMuc3RhcnR1cEhhbmRvZmZTbmFwc2hvdC5sZW5ndGggPiAwKSByZXR1cm5cbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fcmV0cnlQZW5kaW5nSGFuZG9mZlJlY292ZXJpZXMoKVxuICAgIH0gY2F0Y2gge1xuICAgICAgdGhpcy5fc2NoZWR1bGVFcnJvclJldHJ5KClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBmb3IgKGNvbnN0IHdvcmtlciBvZiB0aGlzLndvcmtlckhhbmRvZmZzLmtleXMoKSkge1xuICAgICAgICBpZiAoIXRoaXMud29ya2Vycy5oYXMod29ya2VyKSkgYXdhaXQgdGhpcy5fcmVsZWFzZVdvcmtlckhhbmRvZmZzKHdvcmtlcilcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5fcmVwb3J0SGFuZG9mZlJlbGVhc2VFcnJvcihlcnJvcilcbiAgICAgIHRoaXMuX3NjaGVkdWxlRXJyb3JSZXRyeSgpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAodGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJhY3RpdmVcIikgYXdhaXQgdGhpcy5fZHJhaW4oKVxuICAgIHRoaXMuX21heWJlU3RvcFJldGlyZWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIElubmVyIGRyYWluIGxvb3A6IHB1bGxzIGVsaWdpYmxlIHF1ZXVlZCBqb2JzIGFuZCBoYW5kcyB0aGVtIG9mZiB0b1xuICAgKiByZWFkeSB3b3JrZXJzIHVudGlsIG9uZSBvZiB0aGVtIHJ1bnMgb3V0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9kcmFpbk9uY2UoKSB7XG4gICAgd2hpbGUgKHRoaXMucmVhZHlXb3JrZXJzLnNpemUgPiAwICYmICF0aGlzLl9zdG9wcGVkICYmIHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwiYWN0aXZlXCIgJiYgdGhpcy5fYWN0aXZlT3duZXJzaGlwUmVhZHkpIHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMubmV4dEF2YWlsYWJsZUpvYkZvclJlYWR5V29ya2VycygpXG4gICAgICBpZiAoIWpvYikgcmV0dXJuXG5cbiAgICAgIGNvbnN0IHdvcmtlciA9IHRoaXMucmVhZHlXb3JrZXJGb3JKb2Ioam9iKVxuICAgICAgaWYgKCF3b3JrZXIpIHJldHVyblxuXG4gICAgICBjb25zdCBhZG1pc3Npb24gPSB0aGlzLl9jb25zdW1lV29ya2VyQWRtaXNzaW9uKHtqb2IsIHdvcmtlcn0pXG4gICAgICBjb25zdCByZXF1ZXN0ZWRIYW5kb2ZmSWQgPSByYW5kb21VVUlEKClcbiAgICAgIGxldCBoYW5kb2ZmXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGhhbmRvZmYgPSBhd2FpdCB0aGlzLnN0b3JlLm1hcmtIYW5kZWRPZmYoe2hhbmRvZmZJZDogcmVxdWVzdGVkSGFuZG9mZklkLCBqb2JJZDogam9iLmlkLCB3b3JrZXJJZDogd29ya2VyLndvcmtlcklkfSlcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRoaXMuX3JlbWVtYmVySGFuZG9mZlJlY292ZXJ5KHtoYW5kb2ZmSWQ6IHJlcXVlc3RlZEhhbmRvZmZJZCwgam9iSWQ6IGpvYi5pZH0pXG4gICAgICAgIHRoaXMuX3Jlc3RvcmVXb3JrZXJBZG1pc3Npb24oey4uLmFkbWlzc2lvbiwgd29ya2VyfSlcblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IHRoaXMuX3JlY292ZXJIYW5kb2ZmKHtoYW5kb2ZmSWQ6IHJlcXVlc3RlZEhhbmRvZmZJZCwgam9iSWQ6IGpvYi5pZH0pXG4gICAgICAgIH0gY2F0Y2ggKHJlY292ZXJ5RXJyb3IpIHtcbiAgICAgICAgICB0aGlzLl9yZXBvcnRIYW5kb2ZmUmVjb3ZlcnlFcnJvcih7ZXJyb3I6IHJlY292ZXJ5RXJyb3IsIGhhbmRvZmZJZDogcmVxdWVzdGVkSGFuZG9mZklkLCBqb2JJZDogam9iLmlkfSlcbiAgICAgICAgfVxuXG4gICAgICAgIHRocm93IGVycm9yXG4gICAgICB9XG5cbiAgICAgIGlmICghaGFuZG9mZikge1xuICAgICAgICB0aGlzLl9yZXN0b3JlV29ya2VyQWRtaXNzaW9uKHsuLi5hZG1pc3Npb24sIHdvcmtlcn0pXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuYWZ0ZXJIYW5kb2ZmQ2xhaW0/Lih7aGFuZG9mZiwgam9ifSlcblxuICAgICAgY29uc3QgaGFuZG9mZnMgPSB0aGlzLndvcmtlckhhbmRvZmZzLmdldCh3b3JrZXIpXG5cbiAgICAgIGlmICghaGFuZG9mZnMgfHwgIXRoaXMud29ya2Vycy5oYXMod29ya2VyKSB8fCB3b3JrZXIuaXNEcmFpbmluZyB8fCB0aGlzLmxpZmVjeWNsZVN0YXRlICE9PSBcImFjdGl2ZVwiIHx8ICF0aGlzLl9hY3RpdmVPd25lcnNoaXBSZWFkeSkge1xuICAgICAgICB0aGlzLl9yZW1lbWJlckhhbmRvZmZSZWNvdmVyeSh7aGFuZG9mZklkOiBoYW5kb2ZmLmhhbmRvZmZJZCwgam9iSWQ6IGpvYi5pZH0pXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5fcmVjb3ZlckhhbmRvZmYoe2hhbmRvZmZJZDogaGFuZG9mZi5oYW5kb2ZmSWQsIGpvYklkOiBqb2IuaWR9KVxuICAgICAgICB9IGNhdGNoIChyZWNvdmVyeUVycm9yKSB7XG4gICAgICAgICAgdGhpcy5fcmVwb3J0SGFuZG9mZlJlY292ZXJ5RXJyb3Ioe2Vycm9yOiByZWNvdmVyeUVycm9yLCBoYW5kb2ZmSWQ6IGhhbmRvZmYuaGFuZG9mZklkLCBqb2JJZDogam9iLmlkfSlcbiAgICAgICAgICB0aHJvdyByZWNvdmVyeUVycm9yXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fbm90aWZ5RW5xdWV1ZWQoKVxuICAgICAgICB0aGlzLl9yZWRyYWluUXVldWVkID0gdHJ1ZVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICB0aGlzLl9maW5hbGl6ZVdvcmtlckFkbWlzc2lvbih7Li4uYWRtaXNzaW9uLCBqb2IsIHdvcmtlcn0pXG4gICAgICBoYW5kb2Zmcy5zZXQoam9iLmlkLCBoYW5kb2ZmLmhhbmRvZmZJZClcblxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgZGlzcGF0Y2hlZEpvYiA9IGhhbmRvZmYuam9iIHx8IGpvYlxuXG4gICAgICAgIHdvcmtlci5zZW5kKHtcbiAgICAgICAgICB0eXBlOiBcImpvYlwiLFxuICAgICAgICAgIHBheWxvYWQ6IHtcbiAgICAgICAgICAgIGlkOiBkaXNwYXRjaGVkSm9iLmlkLFxuICAgICAgICAgICAgam9iTmFtZTogZGlzcGF0Y2hlZEpvYi5qb2JOYW1lLFxuICAgICAgICAgICAgYXJnczogZGlzcGF0Y2hlZEpvYi5hcmdzLFxuICAgICAgICAgICAgaGFuZG9mZklkOiBoYW5kb2ZmLmhhbmRvZmZJZCxcbiAgICAgICAgICAgIHdvcmtlcklkOiB3b3JrZXIud29ya2VySWQsXG4gICAgICAgICAgICBoYW5kZWRPZmZBdE1zOiBoYW5kb2ZmLmhhbmRlZE9mZkF0TXMsXG4gICAgICAgICAgICBvcHRpb25zOiB7XG4gICAgICAgICAgICAgIGNvbmN1cnJlbmN5S2V5OiBkaXNwYXRjaGVkSm9iLmNvbmN1cnJlbmN5S2V5IHx8IHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgZXhlY3V0aW9uTW9kZTogZGlzcGF0Y2hlZEpvYi5leGVjdXRpb25Nb2RlLFxuICAgICAgICAgICAgICBtYXhDb25jdXJyZW5jeTogZGlzcGF0Y2hlZEpvYi5tYXhDb25jdXJyZW5jeSA/PyB1bmRlZmluZWQsXG4gICAgICAgICAgICAgIG1heFJldHJpZXM6IGRpc3BhdGNoZWRKb2IubWF4UmV0cmllcyA/PyB1bmRlZmluZWQsXG4gICAgICAgICAgICAgIHF1ZXVlOiBkaXNwYXRjaGVkSm9iLnF1ZXVlLFxuICAgICAgICAgICAgICBzY2hlZHVsZWRBdE1zOiBkaXNwYXRjaGVkSm9iLnNjaGVkdWxlZEF0TXMgPz8gdW5kZWZpbmVkLFxuICAgICAgICAgICAgICAuLi4oZGlzcGF0Y2hlZEpvYi50aW1lb3V0TXMgPT09IG51bGwgPyB7fSA6IHt0aW1lb3V0TXM6IGRpc3BhdGNoZWRKb2IudGltZW91dE1zfSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aGlzLmxvZ2dlci53YXJuKCgpID0+IFtcIkZhaWxlZCB0byBzZW5kIGpvYiB0byB3b3JrZXIsIHJlLXF1ZXVlaW5nOlwiLCBlcnJvcl0pXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgd29ya2VyLmNsb3NlKClcbiAgICAgICAgfSBjYXRjaCAoY2xvc2VFcnJvcikge1xuICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oKCkgPT4gW1wiRmFpbGVkIHRvIGNsb3NlIHdvcmtlciBhZnRlciBqb2Igc2VuZCBmYWlsdXJlOlwiLCBjbG9zZUVycm9yXSlcbiAgICAgICAgfVxuICAgICAgICBhd2FpdCB0aGlzLl9oYW5kbGVXb3JrZXJTb2NrZXRDbG9zZWQod29ya2VyLCB7cXVldWVSZWRyYWluOiB0cnVlfSlcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ29uc3VtZXMgb25lIGFkdmVydGlzZWQgd29ya2VyIGFkbWlzc2lvbiB3aGlsZSBwZXJzaXN0ZW5jZSBpcyBpbiBmbGlnaHQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQWRtaXNzaW9uIGRldGFpbHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBhcmdzLmpvYiAtIFNlbGVjdGVkIGpvYi5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLndvcmtlciAtIFNlbGVjdGVkIHdvcmtlciBzb2NrZXQuXG4gICAqIEByZXR1cm5zIHt7cG9vbGVkQ3JlZGl0Q29uc3VtZWQ6IGJvb2xlYW4sIHJlYWRpbmVzc1ZlcnNpb246IG51bWJlcn19IC0gUmV2ZXJzaWJsZSBhZG1pc3Npb24gZGViaXQuXG4gICAqL1xuICBfY29uc3VtZVdvcmtlckFkbWlzc2lvbih7am9iLCB3b3JrZXJ9KSB7XG4gICAgbGV0IHBvb2xlZENyZWRpdENvbnN1bWVkID0gZmFsc2VcblxuICAgIHRoaXMucmVhZHlXb3JrZXJzLmRlbGV0ZSh3b3JrZXIpXG5cbiAgICBpZiAoam9iLmV4ZWN1dGlvbk1vZGUgPT09IFwicG9vbGVkXCIgJiYgd29ya2VyLnVzZXNQb29sZWRDYXBhY2l0eUNyZWRpdHMgJiYgd29ya2VyLmF2YWlsYWJsZVBvb2xlZFNsb3RzID4gMCkge1xuICAgICAgcG9vbGVkQ3JlZGl0Q29uc3VtZWQgPSB0cnVlXG4gICAgICB3b3JrZXIuYXZhaWxhYmxlUG9vbGVkU2xvdHMgLT0gMVxuICAgICAgaWYgKHdvcmtlci5hdmFpbGFibGVQb29sZWRTbG90cyA+IDApIHRoaXMucmVhZHlXb3JrZXJzLmFkZCh3b3JrZXIpXG4gICAgfVxuXG4gICAgcmV0dXJuIHtwb29sZWRDcmVkaXRDb25zdW1lZCwgcmVhZGluZXNzVmVyc2lvbjogd29ya2VyLnJlYWRpbmVzc1ZlcnNpb259XG4gIH1cblxuICAvKipcbiAgICogUmVzdG9yZXMgYW4gYWRtaXNzaW9uIHRoYXQgbmV2ZXIgcmVhY2hlZCBhIHdvcmtlci4gQSBuZXdlciByZWFkaW5lc3NcbiAgICogYWR2ZXJ0aXNlbWVudCBpcyBhbHJlYWR5IGF1dGhvcml0YXRpdmUsIHNvIGl0cyBwb29sZWQgY291bnQgaXMgbm90IGNoYW5nZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQWRtaXNzaW9uIGRldGFpbHMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5wb29sZWRDcmVkaXRDb25zdW1lZCAtIFdoZXRoZXIgYSBwb29sZWQgY3JlZGl0IHdhcyBkZWJpdGVkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5yZWFkaW5lc3NWZXJzaW9uIC0gUmVhZGluZXNzIGdlbmVyYXRpb24gYXQgZGViaXQgdGltZS5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLndvcmtlciAtIFNlbGVjdGVkIHdvcmtlciBzb2NrZXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3Jlc3RvcmVXb3JrZXJBZG1pc3Npb24oe3Bvb2xlZENyZWRpdENvbnN1bWVkLCByZWFkaW5lc3NWZXJzaW9uLCB3b3JrZXJ9KSB7XG4gICAgaWYgKHRoaXMuX3N0b3BwZWQgfHwgdGhpcy5saWZlY3ljbGVTdGF0ZSAhPT0gXCJhY3RpdmVcIiB8fCAhdGhpcy5fYWN0aXZlT3duZXJzaGlwUmVhZHkgfHwgIXRoaXMud29ya2Vycy5oYXMod29ya2VyKSB8fCB3b3JrZXIuaXNEcmFpbmluZykgcmV0dXJuXG5cbiAgICBpZiAocG9vbGVkQ3JlZGl0Q29uc3VtZWQgJiYgd29ya2VyLnJlYWRpbmVzc1ZlcnNpb24gPT09IHJlYWRpbmVzc1ZlcnNpb24pIHtcbiAgICAgIHdvcmtlci5hdmFpbGFibGVQb29sZWRTbG90cyArPSAxXG4gICAgfVxuXG4gICAgaWYgKHdvcmtlci5zdXBwb3J0c0hhbmRvZmZJZFJlcG9ydGluZykgdGhpcy5yZWFkeVdvcmtlcnMuYWRkKHdvcmtlcilcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIGEgc3VjY2Vzc2Z1bCBwb29sZWQgYWRtaXNzaW9uIHRvIGEgcmVhZGluZXNzIGFkdmVydGlzZW1lbnQgdGhhdFxuICAgKiBhcnJpdmVkIHdoaWxlIHBlcnNpc3RlbmNlIHdhcyBpbiBmbGlnaHQgYW5kIHJlcGxhY2VkIHRoZSBlYXJsaWVyIGRlYml0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFkbWlzc2lvbiBkZXRhaWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gYXJncy5qb2IgLSBTZWxlY3RlZCBqb2IuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5wb29sZWRDcmVkaXRDb25zdW1lZCAtIFdoZXRoZXIgYSBwb29sZWQgY3JlZGl0IHdhcyBkZWJpdGVkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5yZWFkaW5lc3NWZXJzaW9uIC0gUmVhZGluZXNzIGdlbmVyYXRpb24gYXQgZGViaXQgdGltZS5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLndvcmtlciAtIFNlbGVjdGVkIHdvcmtlciBzb2NrZXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2ZpbmFsaXplV29ya2VyQWRtaXNzaW9uKHtqb2IsIHBvb2xlZENyZWRpdENvbnN1bWVkLCByZWFkaW5lc3NWZXJzaW9uLCB3b3JrZXJ9KSB7XG4gICAgaWYgKCFwb29sZWRDcmVkaXRDb25zdW1lZCB8fCBqb2IuZXhlY3V0aW9uTW9kZSAhPT0gXCJwb29sZWRcIikgcmV0dXJuXG4gICAgaWYgKHdvcmtlci5yZWFkaW5lc3NWZXJzaW9uID09PSByZWFkaW5lc3NWZXJzaW9uIHx8ICF3b3JrZXIudXNlc1Bvb2xlZENhcGFjaXR5Q3JlZGl0cykgcmV0dXJuXG4gICAgaWYgKHdvcmtlci5hdmFpbGFibGVQb29sZWRTbG90cyA8PSAwKSByZXR1cm5cblxuICAgIHdvcmtlci5hdmFpbGFibGVQb29sZWRTbG90cyAtPSAxXG4gICAgaWYgKHdvcmtlci5hdmFpbGFibGVQb29sZWRTbG90cyA9PT0gMCkgdGhpcy5yZWFkeVdvcmtlcnMuZGVsZXRlKHdvcmtlcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXRhaW5zIGFuIGV4YWN0IGxlYXNlIGZvciBpZGVtcG90ZW50IHByZS1kaXNwYXRjaCByZWNvdmVyeS5cbiAgICogQHBhcmFtIHt7aGFuZG9mZklkOiBzdHJpbmcsIGpvYklkOiBzdHJpbmd9fSBhcmdzIC0gRXhhY3QgcmVjb3ZlcnkgZmVuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlbWVtYmVySGFuZG9mZlJlY292ZXJ5KHtoYW5kb2ZmSWQsIGpvYklkfSkge1xuICAgIHRoaXMucGVuZGluZ0hhbmRvZmZSZWNvdmVyaWVzLnNldChoYW5kb2ZmSWQsIGpvYklkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgb25lIGV4YWN0IGxlYXNlIGFuZCBmb3JnZXRzIGl0IG9ubHkgYWZ0ZXIgdGhlIGFkYXB0ZXIgYWNrbm93bGVkZ2VzXG4gICAqIHRoZSBmZW5jZWQgdHJhbnNpdGlvbiBvciBjb25maXJtcyBpdCB3YXMgYWxyZWFkeSBhYnNlbnQuXG4gICAqIEBwYXJhbSB7e2hhbmRvZmZJZDogc3RyaW5nLCBqb2JJZDogc3RyaW5nfX0gYXJncyAtIEV4YWN0IHJlY292ZXJ5IGZlbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBkdXJhYmxlIHJlY292ZXJ5IHNldHRsZXMuXG4gICAqL1xuICBhc3luYyBfcmVjb3ZlckhhbmRvZmYoe2hhbmRvZmZJZCwgam9iSWR9KSB7XG4gICAgYXdhaXQgdGhpcy5zdG9yZS5tYXJrUmV0dXJuZWRUb1F1ZXVlKHtoYW5kb2ZmSWQsIGpvYklkfSlcblxuICAgIGlmICh0aGlzLnBlbmRpbmdIYW5kb2ZmUmVjb3Zlcmllcy5nZXQoaGFuZG9mZklkKSA9PT0gam9iSWQpIHtcbiAgICAgIHRoaXMucGVuZGluZ0hhbmRvZmZSZWNvdmVyaWVzLmRlbGV0ZShoYW5kb2ZmSWQpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcGxheXMgcmV0YWluZWQgZXhhY3QtSUQgcmVjb3ZlcmllcyB0aHJvdWdoIHRoZSBkaXNwYXRjaGVyJ3MgZXhpc3RpbmdcbiAgICogdHJhbnNpZW50LWVycm9yIHJldHJ5IGxpZmVjeWNsZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZXZlcnkgcmV0YWluZWQgcmVjb3Zlcnkgc2V0dGxlcy5cbiAgICovXG4gIGFzeW5jIF9yZXRyeVBlbmRpbmdIYW5kb2ZmUmVjb3ZlcmllcygpIHtcbiAgICBmb3IgKGNvbnN0IFtoYW5kb2ZmSWQsIGpvYklkXSBvZiBbLi4udGhpcy5wZW5kaW5nSGFuZG9mZlJlY292ZXJpZXNdKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLl9yZWNvdmVySGFuZG9mZih7aGFuZG9mZklkLCBqb2JJZH0pXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aGlzLl9yZXBvcnRIYW5kb2ZmUmVjb3ZlcnlFcnJvcih7ZXJyb3IsIGhhbmRvZmZJZCwgam9iSWR9KVxuICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTdXJmYWNlcyBhIGZhaWxlZCBleGFjdC1JRCByZWNvdmVyeSB3aXRob3V0IGRyb3BwaW5nIGl0cyByZXRyeSBsZWRnZXIgZW50cnkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUmVjb3ZlcnkgZmFpbHVyZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIEFkYXB0ZXIgZmFpbHVyZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuaGFuZG9mZklkIC0gRXhhY3QgbGVhc2UgZmVuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXBvcnRIYW5kb2ZmUmVjb3ZlcnlFcnJvcih7ZXJyb3IsIGhhbmRvZmZJZCwgam9iSWR9KSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG4gICAgY29uc3QgcGF5bG9hZCA9IHtcbiAgICAgIGNvbnRleHQ6IHtoYW5kb2ZmSWQsIGpvYklkLCBzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi1oYW5kb2ZmLWFkbWlzc2lvbi1yZWNvdmVyeVwifSxcbiAgICAgIGVycm9yOiBub3JtYWxpemVkRXJyb3JcbiAgICB9XG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiRmFpbGVkIHRvIHJlY292ZXIgYW4gYW1iaWd1b3VzIGJhY2tncm91bmQgam9iIGhhbmRvZmY6XCIsIG5vcm1hbGl6ZWRFcnJvcl0pXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBuZXh0IGF2YWlsYWJsZSBqb2IgZm9yIHJlYWR5IHdvcmtlcnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIE5leHQgcXVldWVkIGpvYiBtYXRjaGluZyByZWFkeSB3b3JrZXIgY2FwYWNpdHkuXG4gICAqL1xuICBhc3luYyBuZXh0QXZhaWxhYmxlSm9iRm9yUmVhZHlXb3JrZXJzKCkge1xuICAgIGNvbnN0IGV4ZWN1dGlvbk1vZGVzID0gdGhpcy5yZWFkeVdvcmtlckV4ZWN1dGlvbk1vZGVzKClcblxuICAgIGlmIChleGVjdXRpb25Nb2Rlcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsXG4gICAgaWYgKGV4ZWN1dGlvbk1vZGVzLmxlbmd0aCA9PT0gV09SS0VSX0VYRUNVVElPTl9NT0RFX0NBUEFCSUxJVElFUy5sZW5ndGgpIHJldHVybiBhd2FpdCB0aGlzLnN0b3JlLm5leHRBdmFpbGFibGVKb2IoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuc3RvcmUubmV4dEF2YWlsYWJsZUpvYih7ZXhlY3V0aW9uTW9kZTogZXhlY3V0aW9uTW9kZXN9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVhZHkgd29ya2VyIGV4ZWN1dGlvbiBtb2Rlcy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGVbXX0gLSBFeGVjdXRpb24gbW9kZXMgY3VycmVudGx5IGFjY2VwdGVkIGJ5IHJlYWR5IHdvcmtlcnMuXG4gICAqL1xuICByZWFkeVdvcmtlckV4ZWN1dGlvbk1vZGVzKCkge1xuICAgIGNvbnN0IGV4ZWN1dGlvbk1vZGVzID0gbmV3IFNldCgpXG5cbiAgICBmb3IgKGNvbnN0IHdvcmtlciBvZiB0aGlzLnJlYWR5V29ya2Vycykge1xuICAgICAgdGhpcy5fYWRkQWNjZXB0ZWRFeGVjdXRpb25Nb2Rlcyh7ZXhlY3V0aW9uTW9kZXMsIHdvcmtlcn0pXG4gICAgfVxuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZVtdfSAqLyAoWy4uLmV4ZWN1dGlvbk1vZGVzXSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFkZCBhY2NlcHRlZCBleGVjdXRpb24gbW9kZXMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtTZXQ8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZT59IGFyZ3MuZXhlY3V0aW9uTW9kZXMgLSBBY2NlcHRlZCBtb2Rlcy5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLndvcmtlciAtIFdvcmtlciBzb2NrZXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2FkZEFjY2VwdGVkRXhlY3V0aW9uTW9kZXMoe2V4ZWN1dGlvbk1vZGVzLCB3b3JrZXJ9KSB7XG4gICAgaWYgKCF3b3JrZXIuc3VwcG9ydHNIYW5kb2ZmSWRSZXBvcnRpbmcpIHJldHVyblxuXG4gICAgZm9yIChjb25zdCBjYXBhYmlsaXR5IG9mIFdPUktFUl9FWEVDVVRJT05fTU9ERV9DQVBBQklMSVRJRVMpIHtcbiAgICAgIGlmIChjYXBhYmlsaXR5LmFjY2VwdHMod29ya2VyKSkgZXhlY3V0aW9uTW9kZXMuYWRkKGNhcGFiaWxpdHkuZXhlY3V0aW9uTW9kZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWFkeSB3b3JrZXIgZm9yIGpvYi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGpvYiAtIEpvYiBiZWluZyBoYW5kZWQgb2ZmLlxuICAgKiBAcmV0dXJucyB7SnNvblNvY2tldCB8IHVuZGVmaW5lZH0gLSBSZWFkeSB3b3JrZXIgZm9yIHRoZSBqb2IgdHlwZS5cbiAgICovXG4gIHJlYWR5V29ya2VyRm9ySm9iKGpvYikge1xuICAgIGZvciAoY29uc3Qgd29ya2VyIG9mIHRoaXMucmVhZHlXb3JrZXJzKSB7XG4gICAgICBpZiAodGhpcy5fd29ya2VyQWNjZXB0c0pvYih7am9iLCB3b3JrZXJ9KSkgcmV0dXJuIHdvcmtlclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdvcmtlciBhY2NlcHRzIGpvYi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gYXJncy5qb2IgLSBKb2IgYmVpbmcgaGFuZGVkIG9mZi5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLndvcmtlciAtIFdvcmtlciBzb2NrZXQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIHdvcmtlciBhY2NlcHRzIHRoZSBqb2IgbW9kZS5cbiAgICovXG4gIF93b3JrZXJBY2NlcHRzSm9iKHtqb2IsIHdvcmtlcn0pIHtcbiAgICBpZiAoIXdvcmtlci5zdXBwb3J0c0hhbmRvZmZJZFJlcG9ydGluZykgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBjYXBhYmlsaXR5ID0gV09SS0VSX0VYRUNVVElPTl9NT0RFX0NBUEFCSUxJVElFU19CWV9NT0RFLmdldChqb2IuZXhlY3V0aW9uTW9kZSlcblxuICAgIGlmICghY2FwYWJpbGl0eSkgcmV0dXJuIGZhbHNlXG5cbiAgICByZXR1cm4gY2FwYWJpbGl0eS5hY2NlcHRzKHdvcmtlcilcbiAgfVxuXG4gIC8qKlxuICAgKiBBcm1zIGEgc2luZ2xlIGBzZXRUaW1lb3V0YCBmb3IgdGhlIHNvb25lc3QgZnV0dXJlLXNjaGVkdWxlZCBqb2Inc1xuICAgKiBgc2NoZWR1bGVkX2F0X21zYC4gUmVwbGFjZXMgdGhlIHNlY29uZCByZXNwb25zaWJpbGl0eSBvZiB0aGUgbGVnYWN5XG4gICAqIDEtc2Vjb25kIHBvbGwgKGJlY29taW5nLWVsaWdpYmxlIHNjaGVkdWxlZCBqb2JzKS4gVGhlIHRpbWVyIGlzXG4gICAqIGlkZW1wb3RlbnRseSByZS1hcm1lZCBhdCB0aGUgZW5kIG9mIGV2ZXJ5IGRyYWluLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9hcm1TY2hlZHVsZWRUaW1lcigpIHtcbiAgICBpZiAodGhpcy5fc2NoZWR1bGVkVGltZXIpIHtcbiAgICAgIHRoaXMuY2xvY2suY2xlYXJUaW1lb3V0KHRoaXMuX3NjaGVkdWxlZFRpbWVyKVxuICAgICAgdGhpcy5fc2NoZWR1bGVkVGltZXIgPSB1bmRlZmluZWRcbiAgICB9XG5cbiAgICBpZiAodGhpcy5fc3RvcHBlZCB8fCB0aGlzLmxpZmVjeWNsZVN0YXRlICE9PSBcImFjdGl2ZVwiIHx8ICF0aGlzLl9hY3RpdmVPd25lcnNoaXBSZWFkeSkgcmV0dXJuXG4gICAgaWYgKHRoaXMuZGlzcGF0Y2hTdHJhdGVneSA9PT0gXCJwb2xsaW5nXCIpIHJldHVyblxuXG4gICAgY29uc3QgbmV4dCA9IGF3YWl0IHRoaXMuc3RvcmUubmV4dFNjaGVkdWxlZEpvYigpXG4gICAgbGV0IGRlbGF5XG5cbiAgICBpZiAobmV4dCAmJiB0eXBlb2YgbmV4dC5zY2hlZHVsZWRBdE1zID09PSBcIm51bWJlclwiKSB7XG4gICAgICBkZWxheSA9IE1hdGgubWF4KDAsIE1hdGgubWluKG5leHQuc2NoZWR1bGVkQXRNcyAtIHRoaXMuY2xvY2subm93KCksIE1BWF9USU1FUl9NUykpXG4gICAgfVxuXG4gICAgLy8gYG5leHRTY2hlZHVsZWRKb2JgIG9ubHkgcmV0dXJucyBmdXR1cmUgam9icywgc28gYSBqb2IgdGhhdCBiZWNhbWVcbiAgICAvLyBlbGlnaWJsZSBhZnRlciB0aGUgZHJhaW4ncyBlbGlnaWJsZS1qb2IgcHJvYmUgaXMgaW52aXNpYmxlIHRvIGl0LiBJZiBvbmVcbiAgICAvLyBpcyBkaXNwYXRjaGFibGUgbm93LCBhcm0gYSAwLWRlbGF5IHJlLWRyYWluIHNvIGl0IGlzIGRpc3BhdGNoZWRcbiAgICAvLyBpbW1lZGlhdGVseSBpbnN0ZWFkIG9mIGJlaW5nIHN0cmFuZGVkIHVudGlsIHRoZSBuZXh0IGZ1dHVyZSB0aW1lciAob3JcbiAgICAvLyBleHRlcm5hbCBzaWduYWwpIGZpcmVzLlxuICAgIGlmIChhd2FpdCB0aGlzLm5leHRBdmFpbGFibGVKb2JGb3JSZWFkeVdvcmtlcnMoKSkgZGVsYXkgPSAwXG5cbiAgICBpZiAodHlwZW9mIGRlbGF5ICE9PSBcIm51bWJlclwiKSByZXR1cm5cblxuICAgIHRoaXMuX3NjaGVkdWxlZFRpbWVyID0gdGhpcy5jbG9jay5zZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMuX3NjaGVkdWxlZFRpbWVyID0gdW5kZWZpbmVkXG4gICAgICB2b2lkIHRoaXMuX2RyYWluKClcbiAgICB9LCBkZWxheSlcbiAgfVxuXG4gIGFzeW5jIF9zd2VlcE9ycGhhbnMoKSB7XG4gICAgdHJ5IHtcbiAgICAgIGxldCBvcnBoYW5lZEpvYnNcblxuICAgICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkKSB7XG4gICAgICAgIGNvbnN0IGNvbm5lY3RlZFdvcmtlcklkcyA9IG5ldyBTZXQoKVxuICAgICAgICBmb3IgKGNvbnN0IHdvcmtlciBvZiB0aGlzLndvcmtlcnMpIHtcbiAgICAgICAgICBpZiAod29ya2VyLndvcmtlcklkKSBjb25uZWN0ZWRXb3JrZXJJZHMuYWRkKHdvcmtlci53b3JrZXJJZClcbiAgICAgICAgfVxuICAgICAgICBmb3IgKGNvbnN0IHdvcmtlcklkIG9mIHRoaXMuZGlzY29ubmVjdGVkV29ya2Vycy5rZXlzKCkpIGNvbm5lY3RlZFdvcmtlcklkcy5hZGQod29ya2VySWQpXG5cbiAgICAgICAgY29uc3QgY3V0b2ZmID0gdGhpcy5jbG9jay5ub3coKSAtIEdFTkVSQVRJT05fT1JQSEFORURfQUZURVJfTVNcbiAgICAgICAgY29uc3QgaGFuZG9mZnMgPSAoYXdhaXQgdGhpcy5fZ2VuZXJhdGlvbk93bmVkSGFuZG9mZlNuYXBzaG90KCkpLmZpbHRlcigoaGFuZG9mZikgPT4ge1xuICAgICAgICAgIHJldHVybiBoYW5kb2ZmLmhhbmRlZE9mZkF0TXMgPD0gY3V0b2ZmICYmICFjb25uZWN0ZWRXb3JrZXJJZHMuaGFzKGhhbmRvZmYud29ya2VySWQpXG4gICAgICAgIH0pXG4gICAgICAgIG9ycGhhbmVkSm9icyA9IGhhbmRvZmZzLmxlbmd0aCA9PT0gMFxuICAgICAgICAgID8gW11cbiAgICAgICAgICA6IGF3YWl0IHRoaXMuc3RvcmUubWFya09ycGhhbmVkSGFuZG9mZnMoe2hhbmRvZmZzLCBlcnJvcjogXCJKb2Igb3JwaGFuZWQgYWZ0ZXIgaXRzIGdlbmVyYXRpb24gb3duZXIgZGlzYXBwZWFyZWRcIn0pXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBvcnBoYW5lZEpvYnMgPSBhd2FpdCB0aGlzLnN0b3JlLm1hcmtPcnBoYW5lZEpvYnMoKVxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLl9oYW5kbGVPcnBoYW5lZEpvYnMoe2pvYnM6IG9ycGhhbmVkSm9icywgd2FybmluZzogXCJNYXJrZWQgb3JwaGFuZWQgYmFja2dyb3VuZCBqb2JzXCJ9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICAgIGNvbnN0IHBheWxvYWQgPSB7Y29udGV4dDoge2dlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWQsIHN0YWdlOiBcImJhY2tncm91bmQtam9iLW9ycGhhbi1zd2VlcFwifSwgZXJyb3I6IG5vcm1hbGl6ZWRFcnJvcn1cbiAgICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiRmFpbGVkIHRvIG1hcmsgb3JwaGFuZWQgam9iczpcIiwgbm9ybWFsaXplZEVycm9yXSlcbiAgICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gICAgfVxuXG4gICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwiYWN0aXZlXCIpIGF3YWl0IHRoaXMuX3JlY29uY2lsZUFjdGl2ZUNvbmN1cnJlbmN5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBhaXJzIGR1cmFibGUgYWRtaXNzaW9uIGNvdW50ZXJzIG9uIHRoZSBhY3RpdmUgbWFpbidzIG1haW50ZW5hbmNlIGNhZGVuY2VcbiAgICogYW5kIGltbWVkaWF0ZWx5IHJldHJpZXMgZGlzcGF0Y2ggd2hlbiBjYXBhY2l0eSB3YXMgcmVjb3ZlcmVkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciByZXBhaXIgYW5kIGFueSByZXN1bHRpbmcgZHJhaW4uXG4gICAqL1xuICBhc3luYyBfcmVjb25jaWxlQWN0aXZlQ29uY3VycmVuY3koKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuc3RvcmUucmVjb25jaWxlQWN0aXZlQ29uY3VycmVuY3koKVxuXG4gICAgICBpZiAocmVzdWx0LnJlcGFpcmVkQ291bnQgPiAwKSBhd2FpdCB0aGlzLl9kcmFpbigpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKVxuICAgICAgY29uc3QgcGF5bG9hZCA9IHtjb250ZXh0OiB7Z2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZCwgc3RhZ2U6IFwiYmFja2dyb3VuZC1qb2ItY29uY3VycmVuY3ktcmVjb25jaWxpYXRpb25cIn0sIGVycm9yOiBub3JtYWxpemVkRXJyb3J9XG4gICAgICBjb25zdCBlcnJvckV2ZW50cyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpXG5cbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIkZhaWxlZCB0byByZWNvbmNpbGUgYmFja2dyb3VuZCBqb2IgYWN0aXZlLWNvbmN1cnJlbmN5IGNvdW50czpcIiwgbm9ybWFsaXplZEVycm9yXSlcbiAgICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFB1Ymxpc2hlcyB0aGUgY29tbW9uIHBvc3Qtb3JwaGFuIGxpZmVjeWNsZTogd2FrZSBxdWV1ZWQgcmV0cmllcywgZW1pdCBvbmVcbiAgICogaXNvbGF0ZWQgZXZlbnQgcGVyIGFjY2VwdGVkIHRyYW5zaXRpb24sIGFuZCBkcmFpbiBzbyByZWxlYXNlZCBjb25jdXJyZW5jeVxuICAgKiBjYW4gaW1tZWRpYXRlbHkgYWRtaXQgb3RoZXIgd29yay5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd1tdfSBhcmdzLmpvYnMgLSBBY2NlcHRlZCBvcnBoYW4gdHJhbnNpdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLndhcm5pbmcgLSBMaWZlY3ljbGUgbG9nIG1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSByZXN1bHRpbmcgZHJhaW4uXG4gICAqL1xuICBhc3luYyBfaGFuZGxlT3JwaGFuZWRKb2JzKHtqb2JzLCB3YXJuaW5nfSkge1xuICAgIGlmIChqb2JzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhpcy5fbWF5YmVTdG9wUmV0aXJlZCgpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLmxvZ2dlci53YXJuKCgpID0+IFt3YXJuaW5nLCBqb2JzLmxlbmd0aF0pXG4gICAgLy8gUmVjbGFpbWVkIG9ycGhhbnMgY2FuIGJlY29tZSBgcXVldWVkYCBhZ2FpbiDigJQgd2FrZSB0aGUgZGlzcGF0Y2hlciBmaXJzdFxuICAgIC8vIHNvIGFuIGFwcGxpY2F0aW9uIGV2ZW50IGhhbmRsZXIgdGhhdCB0aHJvd3MgYmVsb3cgY2Fubm90IHN0cmFuZCB0aGVtLlxuICAgIHRoaXMuX25vdGlmeUVucXVldWVkKClcbiAgICAvLyBFbWl0IGJlZm9yZSBhd2FpdGluZyB0aGUgZHJhaW4gc28gYSBibG9ja2VkIGRpc3BhdGNoZXIgY2Fubm90IGRlbGF5XG4gICAgLy8gYXBwbGljYXRpb24gcmVjb3ZlcnkuIElzb2xhdGUgaGFuZGxlcnMgc28gb25lIGNhbm5vdCBzdXBwcmVzcyB0aGUgcmVzdC5cbiAgICBmb3IgKGNvbnN0IGpvYiBvZiBqb2JzKSB7XG4gICAgICB0cnkge1xuICAgICAgICB0aGlzLl9lbWl0QmFja2dyb3VuZEpvYk9ycGhhbmVkKHtqb2J9KVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiQSBiYWNrZ3JvdW5kLWpvYi1vcnBoYW5lZCBldmVudCBoYW5kbGVyIHRocmV3OlwiLCBlcnJvcl0pXG4gICAgICB9XG4gICAgfVxuICAgIGF3YWl0IHRoaXMuX2RyYWluKClcbiAgICB0aGlzLl9tYXliZVN0b3BSZXRpcmVkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBEcm9wcyB3b3JrZXJzIHRoYXQgaGF2ZSBnb25lIHNpbGVudCBwYXN0IGB3b3JrZXJTdGFsZVRpbWVvdXRNc2AgKG5vXG4gICAqIGhlYXJ0YmVhdCwgcmVhZHksIG9yIHJlcG9ydCkuIEEgd2VkZ2VkIHdvcmtlciBrZWVwcyBpdHMgc29ja2V0IG9wZW4sIHNvIHRoZVxuICAgKiBgY2xvc2VgLWJhc2VkIGNsZWFudXAgbmV2ZXIgZmlyZXMgYW5kIGl0cyBpbi1mbGlnaHQgbGVhc2VzIOKAlCBhbmQgdGhlIHdob2xlXG4gICAqIHF1ZXVlIOKAlCBzdGF5IHN0dWNrIHVudGlsIGEgaHVtYW4gbm90aWNlcy4gUmVsZWFzaW5nIHRoZSBsb3N0IHdvcmtlcidzXG4gICAqIGxlYXNlcyBsZXRzIGl0cyBqb2JzIHJ1biBlbHNld2hlcmUgYW5kIHN0b3BzIGRpc3BhdGNoIHRvIGl0OyB0aGUgd29ya2VyJ3NcbiAgICogb3duIHByb2Nlc3MgbGlmZWN5Y2xlIGlzIHRoZSBzdXBlcnZpc29yJ3MgY29uY2Vybi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHN3ZWVwLlxuICAgKi9cbiAgYXN5bmMgX3N3ZWVwU3RhbGVXb3JrZXJzKCkge1xuICAgIGlmICh0aGlzLl9zdG9wcGVkKSByZXR1cm5cblxuICAgIGNvbnN0IGN1dG9mZiA9IHRoaXMuY2xvY2subm93KCkgLSB0aGlzLndvcmtlclN0YWxlVGltZW91dE1zXG4gICAgLyoqIEB0eXBlIHtKc29uU29ja2V0W119ICovXG4gICAgY29uc3Qgc3RhbGUgPSBbXVxuXG4gICAgZm9yIChjb25zdCB3b3JrZXIgb2YgdGhpcy53b3JrZXJzKSB7XG4gICAgICAvLyBPbmx5IGV2aWN0IGhlYXJ0YmVhdC1jYXBhYmxlIHdvcmtlcnMuIEEgbGVnYWN5IHdvcmtlciAoZS5nLiBvbmUgZnJvbSB0aGVcbiAgICAgIC8vIHByZXZpb3VzIHJlbGVhc2UgZHVyaW5nIGEgcm9sbGluZyBkZXBsb3kpIG5ldmVyIGhlYXJ0YmVhdHMsIHNvIGV2aWN0aW5nXG4gICAgICAvLyBpdCBvbiBzaWxlbmNlIHdvdWxkIHdyb25nbHkgcmVsZWFzZSB0aGUgbGVhc2VzIG9mIGEgam9iIGl0IGlzIHN0aWxsXG4gICAgICAvLyBydW5uaW5nLiBJdHMgZGlzY29ubmVjdCBpcyBzdGlsbCBoYW5kbGVkIGJ5IHRoZSBzb2NrZXQgYGNsb3NlYCBwYXRoLlxuICAgICAgaWYgKCF3b3JrZXIuc3VwcG9ydHNIZWFydGJlYXQpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGxhc3RTZWVuQXQgPSB0eXBlb2Ygd29ya2VyLmxhc3RTZWVuQXQgPT09IFwibnVtYmVyXCIgPyB3b3JrZXIubGFzdFNlZW5BdCA6IDBcblxuICAgICAgaWYgKGxhc3RTZWVuQXQgPD0gY3V0b2ZmKSBzdGFsZS5wdXNoKHdvcmtlcilcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHdvcmtlciBvZiBzdGFsZSkge1xuICAgICAgdGhpcy5sb2dnZXIud2FybigoKSA9PiBbXCJEcm9wcGluZyBzdGFsZSBiYWNrZ3JvdW5kIGpvYnMgd29ya2VyXCIsIHt3b3JrZXJJZDogd29ya2VyLndvcmtlcklkLCBsYXN0U2VlbkF0OiB3b3JrZXIubGFzdFNlZW5BdH1dKVxuXG4gICAgICB0cnkge1xuICAgICAgICB3b3JrZXIuY2xvc2UoKVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIEFscmVhZHkgY2xvc2luZzsgdGhlIGxlYXNlIHJlbGVhc2UgYmVsb3cgaXMgd2hhdCBtYXR0ZXJzLlxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLl9oYW5kbGVXb3JrZXJTb2NrZXRDbG9zZWQod29ya2VyKVxuICAgIH1cbiAgfVxufVxuIl19