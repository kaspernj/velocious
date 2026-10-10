// @ts-check
import timeout, { TimeoutError } from "awaitery/build/timeout.js";
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
        this.drainStoreOperationTimeoutMs = config.drainStoreOperationTimeoutMs;
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
            if (error instanceof TimeoutError)
                this._reportDrainStallError(error);
            return true;
        }
    }
    /**
     * Bounds one drain-critical store operation so a store call that never
     * settles rejects into the drain error/retry path instead of stalling the
     * coalesced drain and every later dispatch queued behind it.
     * @template T
     * @param {string} operation - Operation label for the timeout error.
     * @param {() => Promise<T>} callback - Drain store operation.
     * @returns {Promise<T>} - Operation result.
     */
    async _boundedDrainStoreOperation(operation, callback) {
        return await timeout({
            errorMessage: `Background jobs drain store operation timed out after ${this.drainStoreOperationTimeoutMs}ms: ${operation}`,
            timeout: this.drainStoreOperationTimeoutMs
        }, callback);
    }
    /**
     * Surfaces a drain pass whose store operation never settled. The bounded
     * store timeout keeps dispatch moving through the error-retry path; this
     * report makes the stall observable for process-level bug reporters.
     * @param {Error} error - Drain stall failure.
     * @returns {void}
     */
    _reportDrainStallError(error) {
        const payload = {
            context: {
                stage: "background-jobs-drain-stall",
                drainStoreOperationTimeoutMs: this.drainStoreOperationTimeoutMs,
                dispatchStrategy: this.dispatchStrategy
            },
            error
        };
        const errorEvents = this.configuration.getErrorEvents();
        errorEvents.emit("framework-error", payload);
        errorEvents.emit("all-error", { ...payload, errorType: "framework-error" });
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
            const job = await this._boundedDrainStoreOperation("next-available-job", async () => await this.nextAvailableJobForReadyWorkers());
            if (!job)
                return;
            const worker = this.readyWorkerForJob(job);
            if (!worker)
                return;
            const admission = this._consumeWorkerAdmission({ job, worker });
            const requestedHandoffId = randomUUID();
            let handoff;
            try {
                handoff = await this._boundedDrainStoreOperation("mark-handed-off", async () => await this.store.markHandedOff({ handoffId: requestedHandoffId, jobId: job.id, workerId: worker.workerId }));
            }
            catch (error) {
                this._rememberHandoffRecovery({ handoffId: requestedHandoffId, jobId: job.id });
                this._restoreWorkerAdmission({ ...admission, worker });
                try {
                    await this._boundedDrainStoreOperation("recover-handoff", async () => await this._recoverHandoff({ handoffId: requestedHandoffId, jobId: job.id }));
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
                    await this._boundedDrainStoreOperation("recover-handoff", async () => await this._recoverHandoff({ handoffId: handoff.handoffId, jobId: job.id }));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9iYWNrZ3JvdW5kLWpvYnMvbWFpbi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxPQUFPLEVBQUUsRUFBRSxZQUFZLEVBQUUsTUFBTSwyQkFBMkIsQ0FBQTtBQUNqRSxPQUFPLEVBQUUsVUFBVSxFQUFFLE1BQU0sUUFBUSxDQUFBO0FBQ25DLE9BQU8sR0FBRyxNQUFNLEtBQUssQ0FBQTtBQUNyQixPQUFPLFVBQVUsTUFBTSxrQkFBa0IsQ0FBQTtBQUN6QyxPQUFPLHVCQUF1QixNQUFNLGdCQUFnQixDQUFBO0FBQ3BELE9BQU8sTUFBTSxNQUFNLGNBQWMsQ0FBQTtBQUNqQyxPQUFPLDhCQUE4QixNQUFNLDJDQUEyQyxDQUFBO0FBQ3RGLE9BQU8sY0FBYyxNQUFNLHVCQUF1QixDQUFBO0FBQ2xELE9BQU8saUJBQWlCLEVBQUUsRUFBRSxnQkFBZ0IsRUFBRSxNQUFNLGdDQUFnQyxDQUFBO0FBQ3BGLE9BQU8sRUFBRSxvQkFBb0IsRUFBRSwyQkFBMkIsRUFBRSxNQUFNLDBCQUEwQixDQUFBO0FBQzVGLE9BQU8sb0NBQW9DLE1BQU0sK0JBQStCLENBQUE7QUFFaEY7Ozs7O0dBS0c7QUFDSDs7Ozs7O0dBTUc7QUFDSCxNQUFNLGdCQUFnQixHQUFHLG9DQUFvQyxDQUFBO0FBRTdEOzs7O0dBSUc7QUFDSCxNQUFNLFlBQVksR0FBRyxhQUFhLENBQUEsQ0FBQyxhQUFhO0FBQ2hELCtFQUErRTtBQUMvRSxNQUFNLHVCQUF1QixHQUFHLEtBQUssQ0FBQTtBQUNyQyxzREFBc0Q7QUFDdEQsTUFBTSx3QkFBd0IsR0FBRyxLQUFLLENBQUE7QUFDdEMseUZBQXlGO0FBQ3pGLE1BQU0seUJBQXlCLEdBQUcsS0FBSyxDQUFBO0FBQ3ZDLE1BQU0sNEJBQTRCLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxJQUFJLENBQUE7QUFDbkQsTUFBTSx5Q0FBeUMsR0FBRywyREFBMkQsWUFBWSxFQUFFLENBQUE7QUFFM0g7Ozs7O0dBS0c7QUFDSCxTQUFTLCtCQUErQixDQUFDLHNCQUFzQjtJQUM3RCxJQUFJLHNCQUFzQixLQUFLLFNBQVM7UUFBRSxPQUFPLHlCQUF5QixDQUFBO0lBQzFFLElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLHNCQUFzQixDQUFDLElBQUksc0JBQXNCLEdBQUcsQ0FBQyxJQUFJLHNCQUFzQixHQUFHLFlBQVksRUFBRSxDQUFDO1FBQ3JILE1BQU0sSUFBSSxTQUFTLENBQUMseUNBQXlDLENBQUMsQ0FBQTtJQUNoRSxDQUFDO0lBRUQsT0FBTyxzQkFBc0IsQ0FBQTtBQUMvQixDQUFDO0FBQ0Q7OzZDQUU2QztBQUM3QyxNQUFNLGtDQUFrQyxHQUFHO0lBQ3pDLEVBQUMsYUFBYSxFQUFFLFFBQVEsRUFBRSxPQUFPLEVBQUUsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBQyxpQkFBaUIsS0FBSyxLQUFLLEVBQUM7SUFDbEYsRUFBQyxhQUFhLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBRSxDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUMsTUFBTSxDQUFDLGlCQUFpQixLQUFLLEtBQUssRUFBQztJQUNsRiwyRUFBMkU7SUFDM0UsOEVBQThFO0lBQzlFLDhFQUE4RTtJQUM5RSw2RUFBNkU7SUFDN0UseUVBQXlFO0lBQ3pFLEVBQUMsYUFBYSxFQUFFLFFBQVEsRUFBRSxPQUFPLEVBQUUsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBQyxpQkFBaUIsS0FBSyxJQUFJLElBQUksQ0FBQyxDQUFDLE1BQU0sQ0FBQyx5QkFBeUIsSUFBSSxNQUFNLENBQUMsb0JBQW9CLEdBQUcsQ0FBQyxDQUFDLEVBQUM7SUFDM0osRUFBQyxhQUFhLEVBQUUsU0FBUyxFQUFFLE9BQU8sRUFBRSxDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUMsTUFBTSxDQUFDLGtCQUFrQixLQUFLLEtBQUssRUFBQztDQUNyRixDQUFBO0FBQ0QsTUFBTSwwQ0FBMEMsR0FBRyxJQUFJLEdBQUcsQ0FDeEQsa0NBQWtDLENBQUMsR0FBRyxDQUFDLENBQUMsVUFBVSxFQUFFLEVBQUUsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxhQUFhLEVBQUUsVUFBVSxDQUFDLENBQUMsQ0FDL0YsQ0FBQTtBQUVELE1BQU0sQ0FBQyxPQUFPLE9BQU8sa0JBQWtCO0lBQ3JDOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O09Bc0JHO0lBQ0gsWUFBWSxFQUFDLGFBQWEsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLFlBQVksRUFBRSxvQkFBb0IsRUFBRSxzQkFBc0IsRUFBRSw4QkFBOEIsRUFBRSxtQkFBbUIsRUFBRSwyQkFBMkIsRUFBRSxvQkFBb0IsRUFBRSxxQkFBcUIsRUFBRSxzQkFBc0IsRUFBRSw4QkFBOEIsR0FBRyxJQUFJLEVBQUUsU0FBUyxFQUFFLGlCQUFpQixFQUFFLGFBQWEsRUFBRSxpQkFBaUIsRUFBRSxvQkFBb0IsRUFBRSx3QkFBd0IsRUFBRSwwQkFBMEIsRUFBRSxZQUFZLEVBQUUsS0FBSyxFQUFDO1FBQ2hjLElBQUksQ0FBQyxhQUFhLEdBQUcsYUFBYSxDQUFBO1FBQ2xDLElBQUksQ0FBQyw4QkFBOEIsR0FBRyw4QkFBOEIsQ0FBQTtRQUNwRSxJQUFJLENBQUMsU0FBUyxHQUFHLFNBQVMsQ0FBQTtRQUMxQixJQUFJLENBQUMsaUJBQWlCLEdBQUcsaUJBQWlCLENBQUE7UUFDMUMsSUFBSSxDQUFDLGFBQWEsR0FBRyxhQUFhLENBQUE7UUFDbEMsSUFBSSxDQUFDLGlCQUFpQixHQUFHLGlCQUFpQixDQUFBO1FBQzFDLElBQUksQ0FBQyxvQkFBb0IsR0FBRyxvQkFBb0IsQ0FBQTtRQUNoRCxJQUFJLENBQUMsd0JBQXdCLEdBQUcsd0JBQXdCLENBQUE7UUFDeEQsSUFBSSxDQUFDLDBCQUEwQixHQUFHLDBCQUEwQixDQUFBO1FBQzVELElBQUksQ0FBQyxZQUFZLEdBQUcsWUFBWSxDQUFBO1FBQ2hDLElBQUksQ0FBQyxLQUFLLEdBQUc7WUFDWCxZQUFZLEVBQUUsS0FBSyxFQUFFLFlBQVksSUFBSSxDQUFDLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxZQUFZLENBQUMsT0FBTyxDQUFDLENBQUM7WUFDekUsR0FBRyxFQUFFLEtBQUssRUFBRSxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7WUFDckMsVUFBVSxFQUFFLEtBQUssRUFBRSxVQUFVLElBQUksQ0FBQyxDQUFDLFFBQVEsRUFBRSxPQUFPLEVBQUUsRUFBRSxDQUFDLFVBQVUsQ0FBQyxRQUFRLEVBQUUsT0FBTyxDQUFDLENBQUM7U0FDeEYsQ0FBQTtRQUNELE1BQU0sTUFBTSxHQUFHLGFBQWEsQ0FBQyx1QkFBdUIsRUFBRSxDQUFBO1FBQ3RELE1BQU0sZ0JBQWdCLEdBQUcsYUFBYSxDQUFDLHFDQUFxQyxDQUFDO1lBQzNFLFlBQVksRUFBRSxvQkFBb0I7WUFDbEMsc0JBQXNCLEVBQUUsOEJBQThCO1lBQ3RELG1CQUFtQixFQUFFLDJCQUEyQjtZQUNoRCxVQUFVLEVBQUUsb0JBQW9CO1NBQ2pDLENBQUMsQ0FBQTtRQUNGLElBQUksQ0FBQyxZQUFZLEdBQUcsZ0JBQWdCLENBQUMsWUFBWSxDQUFBO1FBQ2pELElBQUksQ0FBQyxzQkFBc0IsR0FBRyxnQkFBZ0IsQ0FBQyxzQkFBc0IsQ0FBQTtRQUNyRSxJQUFJLENBQUMsbUJBQW1CLEdBQUcsZ0JBQWdCLENBQUMsbUJBQW1CLENBQUE7UUFDL0QsMEVBQTBFO1FBQzFFLElBQUksQ0FBQyxjQUFjLEdBQUcsVUFBVSxDQUFBO1FBQ2hDLElBQUksQ0FBQyxxQkFBcUIsR0FBRyxLQUFLLENBQUE7UUFDbEMsd0NBQXdDO1FBQ3hDLElBQUksQ0FBQyxrQkFBa0IsR0FBRyxTQUFTLENBQUE7UUFDbkMsd0NBQXdDO1FBQ3hDLElBQUksQ0FBQyxrQkFBa0IsR0FBRyxTQUFTLENBQUE7UUFDbkMsOEJBQThCO1FBQzlCLElBQUksQ0FBQyxxQkFBcUIsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1FBQ3RDLCtGQUErRjtRQUMvRixJQUFJLENBQUMsbUJBQW1CLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtRQUNwQyxJQUFJLENBQUMsdUJBQXVCLEdBQUcsQ0FBQyxDQUFBO1FBQ2hDLElBQUksQ0FBQyx3QkFBd0IsR0FBRyxDQUFDLENBQUE7UUFDakM7OztXQUdHO1FBQ0gsSUFBSSxDQUFDLGVBQWUsR0FBRyxHQUFHLEVBQUUsR0FBRSxDQUFDLENBQUE7UUFDL0IsSUFBSSxDQUFDLGVBQWUsR0FBRyxJQUFJLE9BQU8sQ0FBQyxDQUFDLG9DQUFvQyxDQUFDLE9BQU8sRUFBRSxFQUFFLEdBQUcsSUFBSSxDQUFDLGVBQWUsR0FBRyxPQUFPLENBQUEsQ0FBQyxDQUFDLENBQUMsQ0FBQTtRQUN4SCxJQUFJLENBQUMsSUFBSSxHQUFHLElBQUksSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFBO1FBQy9CLElBQUksQ0FBQyxJQUFJLEdBQUcsT0FBTyxJQUFJLEtBQUssUUFBUSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUE7UUFDekQsSUFBSSxDQUFDLGdCQUFnQixHQUFHLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQTtRQUMvQyxJQUFJLENBQUMsY0FBYyxHQUFHLE1BQU0sQ0FBQyxjQUFjLENBQUE7UUFDM0MsSUFBSSxDQUFDLDRCQUE0QixHQUFHLE1BQU0sQ0FBQyw0QkFBNEIsQ0FBQTtRQUN2RSxJQUFJLENBQUMsU0FBUyxHQUFHLE1BQU0sQ0FBQyxTQUFTLENBQUE7UUFDakMseUVBQXlFO1FBQ3pFLDZFQUE2RTtRQUM3RSxJQUFJLENBQUMsb0JBQW9CLEdBQUcsT0FBTyxvQkFBb0IsS0FBSyxRQUFRLElBQUksb0JBQW9CLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLENBQUMsdUJBQXVCLENBQUE7UUFDbEosSUFBSSxDQUFDLHFCQUFxQixHQUFHLE9BQU8scUJBQXFCLEtBQUssUUFBUSxJQUFJLHFCQUFxQixJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMscUJBQXFCLENBQUMsQ0FBQyxDQUFDLHdCQUF3QixDQUFBO1FBQ3ZKLElBQUksQ0FBQyxzQkFBc0IsR0FBRywrQkFBK0IsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFBO1FBQ3JGLHlEQUF5RDtRQUN6RCxJQUFJLENBQUMsT0FBTyxHQUFHLFNBQVMsQ0FBQTtRQUN4QixJQUFJLENBQUMsTUFBTSxHQUFHLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFBO1FBQzlCOztxQ0FFNkI7UUFDN0IsSUFBSSxDQUFDLE9BQU8sR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1FBQ3hCLDhCQUE4QjtRQUM5QixJQUFJLENBQUMsV0FBVyxHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFDNUI7O3FDQUU2QjtRQUM3QixJQUFJLENBQUMsWUFBWSxHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFDN0I7OzBEQUVrRDtRQUNsRCxJQUFJLENBQUMsY0FBYyxHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFDL0I7Ozs7eUNBSWlDO1FBQ2pDLElBQUksQ0FBQyx3QkFBd0IsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1FBQ3pDOzs7d0NBR2dDO1FBQ2hDLElBQUksQ0FBQyw4QkFBOEIsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1FBQy9DOzs7O1dBSUc7UUFDSCxJQUFJLENBQUMsb0JBQW9CLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtRQUNyQyxrRUFBa0U7UUFDbEUsSUFBSSxDQUFDLHNCQUFzQixHQUFHLEVBQUUsQ0FBQTtRQUNoQyw4QkFBOEI7UUFDOUIsSUFBSSxDQUFDLGtDQUFrQyxHQUFHLEVBQUUsQ0FBQTtRQUM1QyxJQUFJLENBQUMsMkJBQTJCLEdBQUcsS0FBSyxDQUFBO1FBQ3hDOzs0Q0FFb0M7UUFDcEMsSUFBSSxDQUFDLE1BQU0sR0FBRyxTQUFTLENBQUE7UUFDdkI7OytEQUV1RDtRQUN2RCxJQUFJLENBQUMsVUFBVSxHQUFHLFNBQVMsQ0FBQTtRQUMzQjs7d0VBRWdFO1FBQ2hFLElBQUksQ0FBQyxlQUFlLEdBQUcsU0FBUyxDQUFBO1FBQ2hDOzsrREFFdUQ7UUFDdkQsSUFBSSxDQUFDLGdCQUFnQixHQUFHLFNBQVMsQ0FBQTtRQUNqQzs7K0RBRXVEO1FBQ3ZELElBQUksQ0FBQyxZQUFZLEdBQUcsU0FBUyxDQUFBO1FBQzdCOztnRUFFd0Q7UUFDeEQsSUFBSSxDQUFDLGlCQUFpQixHQUFHLFNBQVMsQ0FBQTtRQUNsQyxpRUFBaUU7UUFDakUsSUFBSSxDQUFDLDJCQUEyQixHQUFHLFNBQVMsQ0FBQTtRQUM1Qyx3Q0FBd0M7UUFDeEMsSUFBSSxDQUFDLDZCQUE2QixHQUFHLFNBQVMsQ0FBQTtRQUM5Qzs7eURBRWlEO1FBQ2pELElBQUksQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFBO1FBQzFCLElBQUksQ0FBQyxTQUFTLEdBQUcsS0FBSyxDQUFBO1FBQ3RCLElBQUksQ0FBQyxjQUFjLEdBQUcsS0FBSyxDQUFBO1FBQzNCLHdDQUF3QztRQUN4QyxJQUFJLENBQUMsYUFBYSxHQUFHLFNBQVMsQ0FBQTtRQUM5QixJQUFJLENBQUMsUUFBUSxHQUFHLEtBQUssQ0FBQTtRQUNyQix3Q0FBd0M7UUFDeEMsSUFBSSxDQUFDLFdBQVcsR0FBRyxTQUFTLENBQUE7UUFDNUI7OzhDQUVzQztRQUN0QyxJQUFJLENBQUMsa0JBQWtCLEdBQUcsU0FBUyxDQUFBO1FBQ25DOzsyRkFFbUY7UUFDbkYsSUFBSSxDQUFDLHFCQUFxQixHQUFHLFNBQVMsQ0FBQTtRQUN0Qzs7MEhBRWtIO1FBQ2xILElBQUksQ0FBQyxhQUFhLEdBQUcsU0FBUyxDQUFBO1FBQzlCLCtEQUErRDtRQUMvRCxJQUFJLENBQUMsc0JBQXNCLEdBQUcsU0FBUyxDQUFBO0lBQ3pDLENBQUM7SUFFRDs7O09BR0c7SUFDSCxJQUFJLEtBQUs7UUFDUCxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU87WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLG1EQUFtRCxDQUFDLENBQUE7UUFFdkYsT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFBO0lBQ3JCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxJQUFJLEtBQUssQ0FBQyxPQUFPO1FBQ2YsSUFBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUE7SUFDeEIsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxLQUFLO1FBQ1QsSUFBSSxDQUFDLFFBQVEsR0FBRyxLQUFLLENBQUE7UUFDckIsSUFBSSxDQUFDLFdBQVcsR0FBRyxTQUFTLENBQUE7UUFDNUIsSUFBSSxDQUFDLHFCQUFxQixHQUFHLEtBQUssQ0FBQTtRQUNsQyxJQUFJLENBQUMsY0FBYyxHQUFHLFVBQVUsQ0FBQTtRQUNoQyxJQUFJLENBQUMsZUFBZSxHQUFHLElBQUksT0FBTyxDQUFDLENBQUMsb0NBQW9DLENBQUMsT0FBTyxFQUFFLEVBQUUsR0FBRyxJQUFJLENBQUMsZUFBZSxHQUFHLE9BQU8sQ0FBQSxDQUFDLENBQUMsQ0FBQyxDQUFBO1FBQ3hILElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxLQUFLLEVBQUUsQ0FBQTtRQUNqQyxJQUFJLENBQUMsc0JBQXNCLEdBQUcsRUFBRSxDQUFBO1FBQ2hDLElBQUksQ0FBQyxrQ0FBa0MsR0FBRyxFQUFFLENBQUE7UUFDNUMsSUFBSSxDQUFDLDJCQUEyQixHQUFHLEtBQUssQ0FBQTtRQUN4QyxJQUFJLENBQUMsNkJBQTZCLEdBQUcsU0FBUyxDQUFBO1FBQzlDLElBQUksQ0FBQyxhQUFhLENBQUMsVUFBVSxFQUFFLENBQUE7UUFFL0IsSUFBSSxDQUFDO1lBQ0gsTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLFVBQVUsQ0FBQyxFQUFDLElBQUksRUFBRSxzQkFBc0IsRUFBQyxDQUFDLENBQUE7WUFDbkUsTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLGFBQWEsQ0FBQyxFQUFDLFFBQVEsRUFBRSxzQkFBc0IsRUFBQyxDQUFDLENBQUE7WUFFMUUsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztnQkFDbEIsSUFBSSxDQUFDLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQyxhQUFhLENBQUMsaUNBQWlDLEVBQUUsQ0FBQTtZQUM3RSxDQUFDO1lBQ0QsSUFBSSxJQUFJLENBQUMsWUFBWSxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxnQ0FBZ0MsRUFBRSxFQUFFLENBQUM7Z0JBQzFFLE1BQU0sSUFBSSxLQUFLLENBQUMsb0ZBQW9GLENBQUMsQ0FBQTtZQUN2RyxDQUFDO1lBQ0QsSUFBSSxJQUFJLENBQUMsWUFBWSxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQywrQkFBK0IsRUFBRSxFQUFFLENBQUM7Z0JBQ3pFLE1BQU0sSUFBSSxLQUFLLENBQUMsc0ZBQXNGLENBQUMsQ0FBQTtZQUN6RyxDQUFDO1lBRUQsSUFBSSxDQUFDLElBQUksQ0FBQyxZQUFZLElBQUksSUFBSSxDQUFDLHNCQUFzQixLQUFLLFdBQVcsRUFBRSxDQUFDO2dCQUN0RSxJQUFJLENBQUMsc0JBQXNCLEdBQUcsTUFBTSxJQUFJLENBQUMsK0JBQStCLEVBQUUsQ0FBQTtZQUM1RSxDQUFDO1lBQ0QsTUFBTSxNQUFNLEdBQUcsR0FBRyxDQUFDLFlBQVksQ0FBQyxDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUE7WUFDM0UsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUE7WUFFcEIsTUFBTSxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsRUFBRTtnQkFDcEMsTUFBTSxDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUUsTUFBTSxDQUFDLENBQUE7Z0JBQzVCLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxJQUFJLENBQUMsSUFBSSxFQUFFLEdBQUcsRUFBRSxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFBO1lBQy9ELENBQUMsQ0FBQyxDQUFBO1lBRUYsTUFBTSxPQUFPLEdBQUcsTUFBTSxDQUFDLE9BQU8sRUFBRSxDQUFBO1lBQ2hDLElBQUksT0FBTyxJQUFJLE9BQU8sT0FBTyxLQUFLLFFBQVEsRUFBRSxDQUFDO2dCQUMzQyxJQUFJLENBQUMsSUFBSSxHQUFHLE9BQU8sQ0FBQyxJQUFJLENBQUE7WUFDMUIsQ0FBQztZQUVELElBQUksQ0FBQyxjQUFjLEdBQUcsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLHNCQUFzQixDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUE7WUFFaEYsSUFBSSxJQUFJLENBQUMsWUFBWSxJQUFJLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxDQUFDO2dCQUNsRCxJQUFJLENBQUMsc0JBQXNCLEdBQUcsSUFBSSxvQ0FBb0MsQ0FBQztvQkFDckUsYUFBYSxFQUFFLElBQUksQ0FBQyxhQUFhO29CQUNqQyxZQUFZLEVBQUUsSUFBSSxDQUFDLFlBQVk7b0JBQy9CLElBQUksRUFBRSxJQUFJO29CQUNWLFVBQVUsRUFBRSxJQUFJLENBQUMsbUJBQW1CO2lCQUNyQyxDQUFDLENBQUE7Z0JBQ0YsTUFBTSxJQUFJLENBQUMsc0JBQXNCLENBQUMsS0FBSyxFQUFFLENBQUE7WUFDM0MsQ0FBQztZQUVELElBQUksQ0FBQyxpQkFBaUIsR0FBRyxXQUFXLENBQUMsR0FBRyxFQUFFO2dCQUN4QyxLQUFLLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxDQUFBO1lBQ2hDLENBQUMsRUFBRSxJQUFJLENBQUMscUJBQXFCLENBQUMsQ0FBQTtZQUU5QixJQUFJLElBQUksQ0FBQyxjQUFjLEtBQUssUUFBUSxFQUFFLENBQUM7Z0JBQ3JDLE1BQU0sSUFBSSxDQUFDLHFCQUFxQixDQUFDLFFBQVEsQ0FBQyxDQUFBO1lBQzVDLENBQUM7aUJBQU0sSUFBSSxJQUFJLENBQUMsY0FBYyxLQUFLLFNBQVMsRUFBRSxDQUFDO2dCQUM3QyxJQUFJLENBQUMsaUNBQWlDLEVBQUUsQ0FBQTtZQUMxQyxDQUFDO1FBQ0gsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixJQUFJLFlBQVksQ0FBQTtZQUVoQixJQUFJLENBQUM7Z0JBQ0gsTUFBTSxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUE7WUFDbkIsQ0FBQztZQUFDLE9BQU8sa0JBQWtCLEVBQUUsQ0FBQztnQkFDNUIsWUFBWSxHQUFHLGtCQUFrQixDQUFBO1lBQ25DLENBQUM7WUFFRCxJQUFJLFlBQVksRUFBRSxDQUFDO2dCQUNqQixNQUFNLElBQUksY0FBYyxDQUN0QixDQUFDLEtBQUssRUFBRSxZQUFZLENBQUMsRUFDckIsaURBQWlELEVBQ2pELEVBQUMsS0FBSyxFQUFFLEtBQUssRUFBQyxDQUNmLENBQUE7WUFDSCxDQUFDO1lBRUQsTUFBTSxLQUFLLENBQUE7UUFDYixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7T0FHRztJQUNILElBQUk7UUFDRixJQUFJLENBQUMsSUFBSSxDQUFDLFdBQVc7WUFBRSxJQUFJLENBQUMsV0FBVyxHQUFHLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQTtRQUV0RCxPQUFPLElBQUksQ0FBQyxXQUFXLENBQUE7SUFDekIsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxLQUFLO1FBQ1QsSUFBSSxDQUFDLFFBQVEsR0FBRyxJQUFJLENBQUE7UUFFcEIsSUFBSSxDQUFDO1lBQ0gsTUFBTSxpQkFBaUIsQ0FBQztnQkFDdEIsU0FBUyxFQUFFLElBQUksQ0FBQyxTQUFTO2dCQUN6QixRQUFRLEVBQUUsS0FBSyxJQUFJLEVBQUU7b0JBQ25CLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQTtvQkFDcEIsSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFBO29CQUNuQixJQUFJLENBQUMseUJBQXlCLEVBQUUsQ0FBQTtvQkFDaEMsSUFBSSxDQUFDO3dCQUNILE1BQU0sSUFBSSxDQUFDLFNBQVMsRUFBRSxJQUFJLEVBQUUsQ0FBQTt3QkFDNUIsSUFBSSxJQUFJLENBQUMsYUFBYTs0QkFBRSxNQUFNLElBQUksQ0FBQyxhQUFhLENBQUE7b0JBQ2xELENBQUM7NEJBQVMsQ0FBQzt3QkFDVCxJQUFJLENBQUM7NEJBQ0gsTUFBTSxJQUFJLENBQUMsNEJBQTRCLEVBQUUsQ0FBQTt3QkFDM0MsQ0FBQztnQ0FBUyxDQUFDOzRCQUNULElBQUksQ0FBQztnQ0FDSCxNQUFNLElBQUksQ0FBQywyQkFBMkIsRUFBRSxDQUFBOzRCQUMxQyxDQUFDO29DQUFTLENBQUM7Z0NBQ1QsTUFBTSxJQUFJLENBQUMsb0JBQW9CLEVBQUUsQ0FBQTs0QkFDbkMsQ0FBQzt3QkFDSCxDQUFDO29CQUNILENBQUM7Z0JBQ0gsQ0FBQzthQUNGLENBQUMsQ0FBQTtRQUNKLENBQUM7Z0JBQVMsQ0FBQztZQUNULElBQUksQ0FBQyxPQUFPLEdBQUcsU0FBUyxDQUFBO1lBQ3hCLElBQUksQ0FBQyxjQUFjLEdBQUcsU0FBUyxDQUFBO1lBQy9CLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQTtRQUN4QixDQUFDO0lBQ0gsQ0FBQztJQUVEOzt5QkFFcUI7SUFDckIsYUFBYTtRQUNYLEtBQUssTUFBTSxVQUFVLElBQUksSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO1lBQzFDLFVBQVUsQ0FBQyxLQUFLLEVBQUUsQ0FBQTtRQUNwQixDQUFDO0lBQ0gsQ0FBQztJQUVEOzt5QkFFcUI7SUFDckIsWUFBWTtRQUNWLElBQUksSUFBSSxDQUFDLFVBQVU7WUFBRSxhQUFhLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBQ25ELElBQUksSUFBSSxDQUFDLGVBQWU7WUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLENBQUE7UUFDdkUsSUFBSSxJQUFJLENBQUMsZ0JBQWdCO1lBQUUsWUFBWSxDQUFDLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFBO1FBQzlELElBQUksSUFBSSxDQUFDLFlBQVk7WUFBRSxhQUFhLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFBO1FBQ3ZELElBQUksSUFBSSxDQUFDLGlCQUFpQjtZQUFFLGFBQWEsQ0FBQyxJQUFJLENBQUMsaUJBQWlCLENBQUMsQ0FBQTtRQUNqRSxJQUFJLElBQUksQ0FBQywyQkFBMkI7WUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsMkJBQTJCLENBQUMsQ0FBQTtRQUMvRixLQUFLLE1BQU0sRUFBQyxLQUFLLEVBQUMsSUFBSSxJQUFJLENBQUMsbUJBQW1CLENBQUMsTUFBTSxFQUFFO1lBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxZQUFZLENBQUMsS0FBSyxDQUFDLENBQUE7UUFDdkYsSUFBSSxDQUFDLG1CQUFtQixDQUFDLEtBQUssRUFBRSxDQUFBO1FBQ2hDLElBQUksQ0FBQyxVQUFVLEdBQUcsU0FBUyxDQUFBO1FBQzNCLElBQUksQ0FBQyxlQUFlLEdBQUcsU0FBUyxDQUFBO1FBQ2hDLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxTQUFTLENBQUE7UUFDakMsSUFBSSxDQUFDLFlBQVksR0FBRyxTQUFTLENBQUE7UUFDN0IsSUFBSSxDQUFDLGlCQUFpQixHQUFHLFNBQVMsQ0FBQTtRQUNsQyxJQUFJLENBQUMsMkJBQTJCLEdBQUcsU0FBUyxDQUFBO0lBQzlDLENBQUM7SUFFRDs7eUJBRXFCO0lBQ3JCLHlCQUF5QjtRQUN2QixJQUFJLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxDQUFDO1lBQzVCLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxDQUFBO1lBQ3pCLElBQUksQ0FBQyxrQkFBa0IsR0FBRyxTQUFTLENBQUE7UUFDckMsQ0FBQztRQUVELElBQUksSUFBSSxDQUFDLGFBQWEsSUFBSSxJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQztZQUNyRCxJQUFJLENBQUMsYUFBYSxDQUFDLEdBQUcsQ0FBQyxTQUFTLEVBQUUsSUFBSSxDQUFDLHFCQUFxQixDQUFDLENBQUE7UUFDL0QsQ0FBQztRQUNELElBQUksQ0FBQyxxQkFBcUIsR0FBRyxTQUFTLENBQUE7UUFDdEMsSUFBSSxDQUFDLGFBQWEsR0FBRyxTQUFTLENBQUE7SUFDaEMsQ0FBQztJQUVEOztrQ0FFOEI7SUFDOUIsS0FBSyxDQUFDLG9CQUFvQjtRQUN4QixNQUFNLGdCQUFnQixDQUFDO1lBQ3JCLE9BQU8sRUFBRSxnRUFBZ0U7WUFDekUsS0FBSyxFQUFFO2dCQUNMLEtBQUssSUFBSSxFQUFFO29CQUNULElBQUksQ0FBQzt3QkFDSCxNQUFNLElBQUksQ0FBQyxzQkFBc0IsRUFBRSxLQUFLLEVBQUUsQ0FBQTtvQkFDNUMsQ0FBQzs0QkFBUyxDQUFDO3dCQUNULElBQUksQ0FBQyxzQkFBc0IsR0FBRyxTQUFTLENBQUE7b0JBQ3pDLENBQUM7Z0JBQ0gsQ0FBQztnQkFDRCxHQUFHLENBQUMsSUFBSSxDQUFDLDhCQUE4QjtvQkFDckMsQ0FBQyxDQUFDLENBQUMsS0FBSyxJQUFJLEVBQUUsQ0FBQyxNQUFNLElBQUksQ0FBQyxhQUFhLENBQUMsUUFBUSxFQUFFLENBQUM7b0JBQ25ELENBQUMsQ0FBQyxFQUFFLENBQUM7Z0JBQ1AsS0FBSyxJQUFJLEVBQUUsQ0FBQyxNQUFNLElBQUksQ0FBQyxhQUFhLENBQUMsZ0JBQWdCLEVBQUU7Z0JBQ3ZELEtBQUssSUFBSSxFQUFFLENBQUMsTUFBTSxJQUFJLENBQUMsWUFBWSxFQUFFO2dCQUNyQyxLQUFLLElBQUksRUFBRTtvQkFDVCxJQUFJLElBQUksQ0FBQyw4QkFBOEIsRUFBRSxDQUFDO3dCQUN4QyxNQUFNLElBQUksQ0FBQyxhQUFhLENBQUMsd0JBQXdCLEVBQUUsQ0FBQTtvQkFDckQsQ0FBQzt5QkFBTSxDQUFDO3dCQUNOLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQywwQkFBMEIsRUFBRSxDQUFBO29CQUN2RCxDQUFDO2dCQUNILENBQUM7YUFDRjtTQUNGLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7a0NBRThCO0lBQzlCLEtBQUssQ0FBQyxZQUFZO1FBQ2hCLElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTTtZQUFFLE9BQU07UUFFeEIsTUFBTSxFQUFDLE1BQU0sRUFBQyxHQUFHLElBQUksQ0FBQTtRQUNyQixJQUFJLENBQUMsTUFBTSxHQUFHLFNBQVMsQ0FBQTtRQUN2QixNQUFNLElBQUksT0FBTyxDQUFDLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUE7SUFDeEUsQ0FBQztJQUVEOzs7T0FHRztJQUNILE9BQU87UUFDTCxPQUFPLElBQUksQ0FBQyxJQUFJLENBQUE7SUFDbEIsQ0FBQztJQUVEOzs7T0FHRztJQUNILGlCQUFpQixLQUFLLE9BQU8sSUFBSSxDQUFDLGNBQWMsQ0FBQSxDQUFDLENBQUM7SUFFbEQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLGdCQUFnQixLQUFLLE1BQU0sSUFBSSxDQUFDLGVBQWUsQ0FBQSxDQUFDLENBQUM7SUFFdkQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQywrQkFBK0I7UUFDbkMsTUFBTSxRQUFRLEdBQUcsTUFBTSxJQUFJLENBQUMsS0FBSyxDQUFDLHFCQUFxQixFQUFFLENBQUE7UUFFekQsSUFBSSxDQUFDLElBQUksQ0FBQyxZQUFZO1lBQUUsT0FBTyxRQUFRLENBQUE7UUFDdkMsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLFlBQVksQ0FBQTtRQUV0QyxPQUFPLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxFQUFDLFFBQVEsRUFBQyxFQUFFLEVBQUUsQ0FBQywyQkFBMkIsQ0FBQyxFQUFDLFlBQVksRUFBRSxRQUFRLEVBQUMsQ0FBQyxDQUFDLENBQUE7SUFDL0YsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMscUJBQXFCLENBQUMsc0JBQXNCO1FBQ2hELE1BQU0sSUFBSSxDQUFDLEtBQUssQ0FBQyx5QkFBeUIsRUFBRSxDQUFBO1FBQzVDLElBQUksSUFBSSxDQUFDLGNBQWMsS0FBSyxzQkFBc0I7WUFBRSxPQUFPLEtBQUssQ0FBQTtRQUNoRSxJQUFJLENBQUMsc0JBQXNCLEVBQUUsQ0FBQTtRQUM3QixJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtRQUN4QixNQUFNLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQTtRQUM1QixJQUFJLElBQUksQ0FBQyxjQUFjLEtBQUssc0JBQXNCLEVBQUUsQ0FBQztZQUNuRCxJQUFJLElBQUksQ0FBQyxTQUFTO2dCQUFFLE1BQU0sSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsQ0FBQTtZQUMvQyxJQUFJLENBQUMsU0FBUyxHQUFHLFNBQVMsQ0FBQTtZQUMxQixJQUFJLENBQUMsb0JBQW9CLEVBQUUsQ0FBQTtZQUMzQixJQUFJLENBQUMseUJBQXlCLEVBQUUsQ0FBQTtZQUNoQyxPQUFPLEtBQUssQ0FBQTtRQUNkLENBQUM7UUFDRCxJQUFJLENBQUMscUJBQXFCLEdBQUcsSUFBSSxDQUFBO1FBQ2pDLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxDQUFBO1FBQzFCLE1BQU0sSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFBO1FBQ25CLElBQUksSUFBSSxDQUFDLGNBQWMsS0FBSyxzQkFBc0I7WUFBRSxJQUFJLENBQUMsMkJBQTJCLEVBQUUsQ0FBQTtRQUN0RixPQUFPLElBQUksQ0FBQyxjQUFjLEtBQUssc0JBQXNCLENBQUE7SUFDdkQsQ0FBQztJQUVELGdGQUFnRjtJQUNoRixpQ0FBaUM7UUFDL0IsSUFBSSxDQUFDLDJCQUEyQixFQUFFLENBQUE7UUFDbEMsSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUE7UUFDeEIsSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUE7SUFDMUIsQ0FBQztJQUVELGlEQUFpRDtJQUNqRCxpQkFBaUI7UUFDZixJQUFJLElBQUksQ0FBQyxZQUFZO1lBQUUsT0FBTTtRQUU3QixJQUFJLENBQUMsWUFBWSxHQUFHLFdBQVcsQ0FBQyxHQUFHLEVBQUUsR0FBRyxLQUFLLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQSxDQUFDLENBQUMsRUFBRSxLQUFLLENBQUMsQ0FBQTtJQUM3RSxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLGVBQWU7UUFDbkIsSUFBSSxJQUFJLENBQUMsU0FBUztZQUFFLE9BQU07UUFFMUIsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLHVCQUF1QixDQUFDO1lBQzNDLGFBQWEsRUFBRSxJQUFJLENBQUMsYUFBYTtZQUNqQyxVQUFVLEVBQUUsS0FBSyxFQUFFLEVBQUMsSUFBSSxFQUFFLFFBQVEsRUFBRSxPQUFPLEVBQUMsRUFBRSxFQUFFO2dCQUM5QyxNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDO29CQUN2QixPQUFPLEVBQUUsUUFBUSxDQUFDLE9BQU8sRUFBRTtvQkFDM0IsSUFBSTtvQkFDSixPQUFPLEVBQUUsUUFBUSxDQUFDLGVBQWUsQ0FBQyxFQUFDLE9BQU8sRUFBRSxJQUFJLEVBQUUsVUFBVSxFQUFFLE9BQU8sRUFBQyxDQUFDO2lCQUN4RSxDQUFDLENBQUE7Z0JBQ0YsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFBO2dCQUN0QixLQUFLLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQTtZQUNwQixDQUFDO1NBQ0YsQ0FBQyxDQUFBO1FBQ0YsTUFBTSxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxDQUFBO1FBRTVCLE1BQU0saUJBQWlCLEdBQUcsOEJBQThCLENBQUMscUJBQXFCLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFBO1FBRTlGLElBQUksaUJBQWlCLEVBQUUsQ0FBQztZQUN0QixJQUFJLENBQUMsU0FBUyxDQUFDLFdBQVcsQ0FBQyxFQUFDLGdCQUFnQixFQUFFLGlCQUFpQixFQUFFLE1BQU0sRUFBRSxzQ0FBc0MsRUFBQyxDQUFDLENBQUE7UUFDbkgsQ0FBQztJQUNILENBQUM7SUFFRCwyRUFBMkU7SUFDM0UsbUJBQW1CO1FBQ2pCLEtBQUssTUFBTSxNQUFNLElBQUksSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUM7WUFDaEQsSUFBSSxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxVQUFVLElBQUksTUFBTSxDQUFDLDBCQUEwQixFQUFFLENBQUM7Z0JBQ3hGLElBQUksQ0FBQyxZQUFZLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFBO1lBQy9CLENBQUM7UUFDSCxDQUFDO1FBQ0QsSUFBSSxDQUFDLHFCQUFxQixDQUFDLEtBQUssRUFBRSxDQUFBO0lBQ3BDLENBQUM7SUFFRDs7O09BR0c7SUFDSCxRQUFRO1FBQ04sSUFBSSxDQUFDLElBQUksQ0FBQyxZQUFZO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxnRUFBZ0UsQ0FBQyxDQUFBO1FBQ3pHLElBQUksSUFBSSxDQUFDLGNBQWMsS0FBSyxRQUFRO1lBQUUsT0FBTyxPQUFPLENBQUMsT0FBTyxFQUFFLENBQUE7UUFDOUQsSUFBSSxJQUFJLENBQUMsY0FBYyxLQUFLLFdBQVc7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLG1EQUFtRCxJQUFJLENBQUMsY0FBYyxFQUFFLENBQUMsQ0FBQTtRQUNsSSxJQUFJLENBQUMsSUFBSSxDQUFDLGtCQUFrQjtZQUFFLElBQUksQ0FBQyxrQkFBa0IsR0FBRyxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUE7UUFFeEUsT0FBTyxJQUFJLENBQUMsa0JBQWtCLENBQUE7SUFDaEMsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxTQUFTO1FBQ2IsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxnREFBZ0QsRUFBRSxFQUFDLFlBQVksRUFBRSxJQUFJLENBQUMsWUFBWSxFQUFDLENBQUMsQ0FBQyxDQUFBO1FBQzdHLE1BQU0sZ0JBQWdCLEdBQUcsTUFBTSxJQUFJLENBQUMscUJBQXFCLENBQUMsV0FBVyxDQUFDLENBQUE7UUFDdEUsSUFBSSxDQUFDLGdCQUFnQixJQUFJLElBQUksQ0FBQyxjQUFjLEtBQUssV0FBVyxFQUFFLENBQUM7WUFDN0QsTUFBTSxJQUFJLEtBQUssQ0FBQyxvRkFBb0YsQ0FBQyxDQUFBO1FBQ3ZHLENBQUM7UUFDRCxJQUFJLENBQUMsY0FBYyxHQUFHLFFBQVEsQ0FBQTtRQUM5QixJQUFJLENBQUMsbUJBQW1CLEVBQUUsQ0FBQTtRQUMxQixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLG9EQUFvRCxFQUFFLEVBQUMsWUFBWSxFQUFFLElBQUksQ0FBQyxZQUFZLEVBQUMsQ0FBQyxDQUFDLENBQUE7UUFDakgsS0FBSyxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUMsS0FBSyxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUU7WUFDakMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyx5REFBeUQsRUFBRSxFQUFDLEtBQUssRUFBRSxZQUFZLEVBQUUsSUFBSSxDQUFDLFlBQVksRUFBQyxDQUFDLENBQUMsQ0FBQTtRQUNoSSxDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7O09BR0c7SUFDSCxNQUFNO1FBQ0osSUFBSSxDQUFDLElBQUksQ0FBQyxZQUFZO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxnRUFBZ0UsQ0FBQyxDQUFBO1FBQ3pHLElBQUksSUFBSSxDQUFDLGNBQWMsS0FBSyxVQUFVLElBQUksSUFBSSxDQUFDLGNBQWMsS0FBSyxTQUFTO1lBQUUsT0FBTyxPQUFPLENBQUMsT0FBTyxFQUFFLENBQUE7UUFDckcsTUFBTSxvQkFBb0IsR0FBRyxJQUFJLENBQUMsY0FBYyxLQUFLLFdBQVcsSUFBSSxPQUFPLENBQUMsSUFBSSxDQUFDLGtCQUFrQixDQUFDLENBQUE7UUFDcEcsSUFBSSxJQUFJLENBQUMsY0FBYyxLQUFLLFFBQVEsSUFBSSxDQUFDLG9CQUFvQjtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsaURBQWlELElBQUksQ0FBQyxjQUFjLEVBQUUsQ0FBQyxDQUFBO1FBRXRKLElBQUksQ0FBQyxjQUFjLEdBQUcsVUFBVSxDQUFBO1FBQ2hDLElBQUksQ0FBQyxxQkFBcUIsR0FBRyxLQUFLLENBQUE7UUFDbEMsSUFBSSxDQUFDLFlBQVksQ0FBQyxLQUFLLEVBQUUsQ0FBQTtRQUN6QixJQUFJLENBQUMscUJBQXFCLENBQUMsS0FBSyxFQUFFLENBQUE7UUFDbEMsSUFBSSxDQUFDLG9CQUFvQixFQUFFLENBQUE7UUFDM0IsSUFBSSxDQUFDLHlCQUF5QixFQUFFLENBQUE7UUFDaEMsSUFBSSxDQUFDLGtCQUFrQixHQUFHLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQTtRQUN4QyxLQUFLLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxLQUFLLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLElBQUksQ0FBQyw2QkFBNkIsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFBO1FBRXhGLE9BQU8sT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFBO0lBQzFCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsT0FBTztRQUNYLElBQUksSUFBSSxDQUFDLGtCQUFrQjtZQUFFLE1BQU0sT0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLENBQUE7UUFDaEYsSUFBSSxJQUFJLENBQUMsU0FBUztZQUFFLE1BQU0sSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsQ0FBQTtRQUMvQyxJQUFJLENBQUMsU0FBUyxHQUFHLFNBQVMsQ0FBQTtRQUMxQixJQUFJLElBQUksQ0FBQyxhQUFhO1lBQUUsTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFBO1FBQ2hELElBQUksSUFBSSxDQUFDLFFBQVE7WUFBRSxPQUFNO1FBRXpCLEtBQUssTUFBTSxNQUFNLElBQUksSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ2xDLE1BQU0sQ0FBQyxVQUFVLEdBQUcsSUFBSSxDQUFBO1lBQ3hCLE1BQU0sQ0FBQyxJQUFJLENBQUMsRUFBQyxJQUFJLEVBQUUsUUFBUSxFQUFFLFlBQVksRUFBRSxJQUFJLENBQUMsWUFBWSxFQUFDLENBQUMsQ0FBQTtRQUNoRSxDQUFDO1FBRUQsSUFBSSxDQUFDLGNBQWMsR0FBRyxTQUFTLENBQUE7UUFDL0IsSUFBSSxDQUFDLGlDQUFpQyxFQUFFLENBQUE7SUFDMUMsQ0FBQztJQUVELDRFQUE0RTtJQUM1RSxvQkFBb0I7UUFDbEIsSUFBSSxJQUFJLENBQUMsVUFBVTtZQUFFLGFBQWEsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUE7UUFDbkQsSUFBSSxJQUFJLENBQUMsZUFBZTtZQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsQ0FBQTtRQUN2RSxJQUFJLElBQUksQ0FBQyxnQkFBZ0I7WUFBRSxZQUFZLENBQUMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLENBQUE7UUFDOUQsSUFBSSxDQUFDLFVBQVUsR0FBRyxTQUFTLENBQUE7UUFDM0IsSUFBSSxDQUFDLGVBQWUsR0FBRyxTQUFTLENBQUE7UUFDaEMsSUFBSSxDQUFDLGdCQUFnQixHQUFHLFNBQVMsQ0FBQTtJQUNuQyxDQUFDO0lBRUQsa0VBQWtFO0lBQ2xFLDRCQUE0QixLQUFLLElBQUksQ0FBQyx1QkFBdUIsSUFBSSxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRXBFLDZFQUE2RTtJQUM3RSw0QkFBNEI7UUFDMUIsSUFBSSxJQUFJLENBQUMsdUJBQXVCLEdBQUcsQ0FBQztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsdURBQXVELENBQUMsQ0FBQTtRQUM5RyxJQUFJLENBQUMsdUJBQXVCLElBQUksQ0FBQyxDQUFBO1FBQ2pDLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFBO0lBQzFCLENBQUM7SUFFRCw2RUFBNkU7SUFDN0UsaUJBQWlCO1FBQ2YsSUFBSSxJQUFJLENBQUMsY0FBYyxLQUFLLFNBQVMsSUFBSSxJQUFJLENBQUMsUUFBUSxJQUFJLElBQUksQ0FBQyxXQUFXO1lBQUUsT0FBTTtRQUNsRixJQUFJLElBQUksQ0FBQyx1QkFBdUIsR0FBRyxDQUFDLElBQUksSUFBSSxDQUFDLHdCQUF3QixHQUFHLENBQUMsSUFBSSxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksR0FBRyxDQUFDLElBQUksSUFBSSxDQUFDLG1CQUFtQixDQUFDLElBQUksR0FBRyxDQUFDO1lBQUUsT0FBTTtRQUMvSSxJQUFJLElBQUksQ0FBQyw4QkFBOEIsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxJQUFJLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxJQUFJLEdBQUcsQ0FBQztZQUFFLE9BQU07UUFDbEcsSUFBSSxJQUFJLENBQUMsYUFBYSxJQUFJLElBQUksQ0FBQyw2QkFBNkIsSUFBSSxJQUFJLENBQUMsMkJBQTJCO1lBQUUsT0FBTTtRQUN4RyxJQUFJLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxNQUFNLEdBQUcsQ0FBQztZQUFFLE9BQU07UUFFbEQsS0FBSyxNQUFNLFFBQVEsSUFBSSxJQUFJLENBQUMsY0FBYyxDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUM7WUFDcEQsSUFBSSxRQUFRLENBQUMsSUFBSSxHQUFHLENBQUM7Z0JBQUUsT0FBTTtRQUMvQixDQUFDO1FBRUQsS0FBSyxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUMsS0FBSyxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsNkJBQTZCLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQTtJQUM5RSxDQUFDO0lBRUQ7Ozs7Ozs7Ozs7T0FVRztJQUNILHNCQUFzQjtRQUNwQixJQUFJLElBQUksQ0FBQyxnQkFBZ0IsS0FBSyxTQUFTLEVBQUUsQ0FBQztZQUN4QyxJQUFJLENBQUMsVUFBVSxHQUFHLFdBQVcsQ0FBQyxHQUFHLEVBQUU7Z0JBQ2pDLEtBQUssSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUE7WUFDOUIsQ0FBQyxFQUFFLElBQUksQ0FBQyxjQUFjLENBQUMsQ0FBQTtZQUN2QixPQUFNO1FBQ1IsQ0FBQztRQUVELE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsZUFBZSxFQUFFLENBQUE7UUFDekQsSUFBSSxDQUFDLFlBQVk7WUFBRSxPQUFNO1FBRXpCLElBQUksQ0FBQyxhQUFhLEdBQUcsWUFBWSxDQUFBO1FBRWpDLElBQUksQ0FBQyxrQkFBa0IsR0FBRyxZQUFZLENBQUMsV0FBVyxDQUFDLENBQUMsT0FBTyxFQUFFLEVBQUU7WUFDN0QsSUFBSSxPQUFPLEVBQUUsT0FBTyxLQUFLLGdCQUFnQjtnQkFBRSxPQUFNO1lBQ2pELEtBQUssSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFBO1FBQ3BCLENBQUMsQ0FBQyxDQUFBO1FBRUYsb0VBQW9FO1FBQ3BFLHFFQUFxRTtRQUNyRSxrQkFBa0I7UUFDbEIsSUFBSSxDQUFDLHFCQUFxQixHQUFHLEdBQUcsRUFBRTtZQUNoQyxLQUFLLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQTtRQUNwQixDQUFDLENBQUE7UUFDRCxZQUFZLENBQUMsRUFBRSxDQUFDLFNBQVMsRUFBRSxJQUFJLENBQUMscUJBQXFCLENBQUMsQ0FBQTtJQUN4RCxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCwyQkFBMkI7UUFDekIsSUFBSSxJQUFJLENBQUMsc0JBQXNCLENBQUMsTUFBTSxLQUFLLENBQUM7WUFBRSxPQUFNO1FBQ3BELElBQUksSUFBSSxDQUFDLDJCQUEyQixJQUFJLElBQUksQ0FBQyw2QkFBNkIsSUFBSSxJQUFJLENBQUMsMkJBQTJCO1lBQUUsT0FBTTtRQUV0SCxJQUFJLENBQUMsMkJBQTJCLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsR0FBRyxFQUFFO1lBQzVELElBQUksQ0FBQywyQkFBMkIsR0FBRyxTQUFTLENBQUE7WUFDNUMsSUFBSSxDQUFDLGtDQUFrQyxHQUFHLENBQUMsR0FBRyxJQUFJLENBQUMsOEJBQThCLENBQUMsQ0FBQTtZQUNsRixJQUFJLENBQUMsMkJBQTJCLEdBQUcsSUFBSSxDQUFBO1lBQ3ZDLEtBQUssSUFBSSxDQUFDLDJCQUEyQixFQUFFLENBQUE7UUFDekMsQ0FBQyxFQUFFLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxDQUFBO1FBQy9CLElBQUksT0FBTyxJQUFJLENBQUMsMkJBQTJCLEtBQUssUUFBUTtZQUFFLElBQUksQ0FBQywyQkFBMkIsQ0FBQyxLQUFLLEVBQUUsQ0FBQTtJQUNwRyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILDJCQUEyQjtRQUN6QixJQUFJLElBQUksQ0FBQyw2QkFBNkI7WUFBRSxPQUFPLElBQUksQ0FBQyw2QkFBNkIsQ0FBQTtRQUVqRixNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsbUNBQW1DLEVBQUUsQ0FBQTtRQUUxRCxJQUFJLENBQUMsNkJBQTZCLEdBQUcsT0FBTyxDQUFBO1FBQzVDLE1BQU0sWUFBWSxHQUFHLEdBQUcsRUFBRTtZQUN4QixJQUFJLElBQUksQ0FBQyw2QkFBNkIsS0FBSyxPQUFPLEVBQUUsQ0FBQztnQkFDbkQsSUFBSSxDQUFDLDZCQUE2QixHQUFHLFNBQVMsQ0FBQTtZQUNoRCxDQUFDO1FBQ0gsQ0FBQyxDQUFBO1FBQ0QsS0FBSyxPQUFPLENBQUMsSUFBSSxDQUFDLFlBQVksRUFBRSxZQUFZLENBQUMsQ0FBQTtRQUU3QyxPQUFPLE9BQU8sQ0FBQTtJQUNoQixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLDJCQUEyQjtRQUMvQixPQUFPLElBQUksQ0FBQyw2QkFBNkIsRUFBRSxDQUFDO1lBQzFDLE1BQU0sSUFBSSxDQUFDLDZCQUE2QixDQUFBO1FBQzFDLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsbUNBQW1DO1FBQ3ZDLElBQUksSUFBSSxDQUFDLFFBQVEsSUFBSSxDQUFDLElBQUksQ0FBQywyQkFBMkI7WUFBRSxPQUFNO1FBQzlELElBQUksSUFBSSxDQUFDLHNCQUFzQixDQUFDLE1BQU0sS0FBSyxDQUFDO1lBQUUsT0FBTTtRQUVwRCxNQUFNLElBQUksQ0FBQyx5Q0FBeUMsRUFBRSxDQUFBO1FBQ3RELElBQUksSUFBSSxDQUFDLFFBQVE7WUFBRSxPQUFNO1FBRXpCLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxNQUFNLENBQUMsQ0FBQyxFQUFDLFFBQVEsRUFBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQTtRQUU3RyxJQUFJLFFBQVEsQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDMUIsSUFBSSxDQUFDLHNCQUFzQixHQUFHLEVBQUUsQ0FBQTtZQUNoQyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtZQUN4QixPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksWUFBWSxDQUFBO1FBRWhCLElBQUksQ0FBQztZQUNILFlBQVksR0FBRyxNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsb0JBQW9CLENBQUM7Z0JBQ25ELEtBQUssRUFBRSw2REFBNkQ7Z0JBQ3BFLFFBQVE7YUFDVCxDQUFDLENBQUE7UUFDSixDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLElBQUksQ0FBQyxpQ0FBaUMsQ0FBQyxLQUFLLENBQUMsQ0FBQTtZQUM3QyxJQUFJLENBQUMsbUJBQW1CLEVBQUUsQ0FBQTtZQUMxQixPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksQ0FBQyxzQkFBc0IsR0FBRyxFQUFFLENBQUE7UUFDaEMsTUFBTSxJQUFJLENBQUMsbUJBQW1CLENBQUM7WUFDN0IsSUFBSSxFQUFFLFlBQVk7WUFDbEIsT0FBTyxFQUFFLHdFQUF3RTtTQUNsRixDQUFDLENBQUE7UUFDRixJQUFJLENBQUMsMEJBQTBCLEVBQUUsQ0FBQyxZQUFZLENBQUMsQ0FBQTtRQUMvQyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtJQUMxQixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMseUNBQXlDO1FBQzdDLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxrQ0FBa0MsQ0FBQTtRQUV6RCxJQUFJLENBQUMsa0NBQWtDLEdBQUcsRUFBRSxDQUFBO1FBQzVDLElBQUksU0FBUyxDQUFDLE1BQU0sS0FBSyxDQUFDO1lBQUUsT0FBTTtRQUVsQyx3REFBd0Q7UUFDeEQsSUFBSSxLQUFLLENBQUE7UUFDVCxNQUFNLFNBQVMsR0FBRyxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxFQUFFO1lBQ3hDLG9FQUFvRTtZQUNwRSxnRUFBZ0U7WUFDaEUsS0FBSyxHQUFHLFVBQVUsQ0FBQyxPQUFPLEVBQUUsSUFBSSxDQUFDLHNCQUFzQixDQUFDLENBQUE7WUFDeEQsS0FBSyxDQUFDLEtBQUssRUFBRSxDQUFBO1FBQ2YsQ0FBQyxDQUFDLENBQUE7UUFFRixJQUFJLENBQUM7WUFDSCxNQUFNLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxFQUFFLFNBQVMsQ0FBQyxDQUFDLENBQUE7UUFDekQsQ0FBQztnQkFBUyxDQUFDO1lBQ1QsSUFBSSxLQUFLO2dCQUFFLFlBQVksQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUNoQyxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILGVBQWU7UUFDYixJQUFJLElBQUksQ0FBQyxnQkFBZ0IsS0FBSyxTQUFTO1lBQUUsT0FBTTtRQUUvQyxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLGVBQWUsRUFBRSxDQUFBO1FBQ3pELElBQUksQ0FBQyxZQUFZLElBQUksQ0FBQyxZQUFZLENBQUMsV0FBVyxFQUFFO1lBQUUsT0FBTTtRQUV4RCxJQUFJLENBQUM7WUFDSCxZQUFZLENBQUMsT0FBTyxDQUFDO2dCQUNuQixPQUFPLEVBQUUsZ0JBQWdCO2dCQUN6QixlQUFlLEVBQUUsRUFBRTtnQkFDbkIsSUFBSSxFQUFFLEVBQUMsTUFBTSxFQUFFLE1BQU0sRUFBQzthQUN2QixDQUFDLENBQUE7UUFDSixDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsbURBQW1ELEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQTtRQUN0RixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxpQkFBaUIsQ0FBQyxNQUFNO1FBQ3RCLE1BQU0sVUFBVSxHQUFHLElBQUksVUFBVSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBQ3pDLElBQUksQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBQ2hDOzt5RUFFaUU7UUFDakUsSUFBSSxJQUFJLEdBQUcsSUFBSSxDQUFBO1FBRWYsSUFBSSxTQUFTLEdBQUcsS0FBSyxDQUFBO1FBQ3JCLE1BQU0sT0FBTyxHQUFHLEdBQUcsRUFBRTtZQUNuQixJQUFJLFNBQVM7Z0JBQUUsT0FBTTtZQUNyQixTQUFTLEdBQUcsSUFBSSxDQUFBO1lBQ2hCLElBQUksQ0FBQyxXQUFXLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFBO1lBRW5DLElBQUksSUFBSSxLQUFLLFFBQVE7Z0JBQUUsS0FBSyxJQUFJLENBQUMseUJBQXlCLENBQUMsVUFBVSxDQUFDLENBQUE7WUFDdEUsSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUE7UUFDMUIsQ0FBQyxDQUFBO1FBRUQsVUFBVSxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsT0FBTyxDQUFDLENBQUE7UUFDL0IsVUFBVSxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxLQUFLLEVBQUUsRUFBRTtZQUMvQixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLG1DQUFtQyxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUE7WUFDcEUsT0FBTyxFQUFFLENBQUE7UUFDWCxDQUFDLENBQUMsQ0FBQTtRQUVGLElBQUksZUFBZSxHQUFHLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQTtRQUN2QyxVQUFVLENBQUMsRUFBRSxDQUFDLFNBQVMsRUFBRSxDQUFDLE9BQU8sRUFBRSxFQUFFO1lBQ25DLGVBQWUsR0FBRyxlQUFlLENBQUMsSUFBSSxDQUFDLEtBQUssSUFBSSxFQUFFO2dCQUNoRCxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUE7Z0JBQ3pCLElBQUksR0FBRyxNQUFNLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxFQUFDLFVBQVUsRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtnQkFDbkUsSUFBSSxZQUFZLEtBQUssUUFBUSxJQUFJLFlBQVksS0FBSyxVQUFVO29CQUFFLFVBQVUsQ0FBQyxLQUFLLEVBQUUsQ0FBQTtZQUNsRixDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRTtnQkFDakIsSUFBSSxDQUFDLDZCQUE2QixDQUFDLEtBQUssQ0FBQyxDQUFBO2dCQUN6QyxVQUFVLENBQUMsS0FBSyxFQUFFLENBQUE7WUFDcEIsQ0FBQyxDQUFDLENBQUE7UUFDSixDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsNkJBQTZCLENBQUMsS0FBSztRQUNqQyxNQUFNLGVBQWUsR0FBRyxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLElBQUksS0FBSyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFBO1FBQ2pGLE1BQU0sT0FBTyxHQUFHLEVBQUMsT0FBTyxFQUFFLEVBQUMsS0FBSyxFQUFFLGdDQUFnQyxFQUFDLEVBQUUsS0FBSyxFQUFFLGVBQWUsRUFBQyxDQUFBO1FBQzVGLE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsY0FBYyxFQUFFLENBQUE7UUFFdkQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyx3Q0FBd0MsRUFBRSxlQUFlLENBQUMsQ0FBQyxDQUFBO1FBQ3BGLFdBQVcsQ0FBQyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsT0FBTyxDQUFDLENBQUE7UUFDNUMsV0FBVyxDQUFDLElBQUksQ0FBQyxXQUFXLEVBQUUsRUFBQyxHQUFHLE9BQU8sRUFBRSxTQUFTLEVBQUUsaUJBQWlCLEVBQUMsQ0FBQyxDQUFBO0lBQzNFLENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsS0FBSyxDQUFDLG9CQUFvQixDQUFDLEVBQUMsVUFBVSxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUM7UUFDcEQsSUFBSSxDQUFDLElBQUk7WUFBRSxPQUFPLE1BQU0sSUFBSSxDQUFDLDRCQUE0QixDQUFDLEVBQUMsVUFBVSxFQUFFLE9BQU8sRUFBQyxDQUFDLENBQUE7UUFDaEYsSUFBSSxJQUFJLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDdEIsTUFBTSxJQUFJLENBQUMsMEJBQTBCLENBQUMsRUFBQyxVQUFVLEVBQUUsT0FBTyxFQUFDLENBQUMsQ0FBQTtZQUM1RCxPQUFPLElBQUksQ0FBQTtRQUNiLENBQUM7UUFFRCxJQUFJLENBQUMsd0JBQXdCLElBQUksQ0FBQyxDQUFBO1FBQ2xDLElBQUksQ0FBQztZQUNILElBQUksSUFBSSxLQUFLLFFBQVE7Z0JBQUUsTUFBTSxJQUFJLENBQUMsMEJBQTBCLENBQUMsRUFBQyxVQUFVLEVBQUUsT0FBTyxFQUFDLENBQUMsQ0FBQTtZQUNuRixJQUFJLElBQUksS0FBSyxVQUFVO2dCQUFFLE1BQU0sSUFBSSxDQUFDLDRCQUE0QixDQUFDLEVBQUMsVUFBVSxFQUFFLE9BQU8sRUFBQyxDQUFDLENBQUE7UUFDekYsQ0FBQztnQkFBUyxDQUFDO1lBQ1QsSUFBSSxDQUFDLHdCQUF3QixJQUFJLENBQUMsQ0FBQTtZQUNsQyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtRQUMxQixDQUFDO1FBRUQsT0FBTyxJQUFJLENBQUE7SUFDYixDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLDRCQUE0QixDQUFDLEVBQUMsVUFBVSxFQUFFLE9BQU8sRUFBQztRQUN0RCxJQUFJLE9BQU8sRUFBRSxJQUFJLEtBQUssT0FBTztZQUFFLE9BQU8sSUFBSSxDQUFBO1FBRTFDLE1BQU0sZUFBZSxHQUFHLElBQUksQ0FBQywrQkFBK0IsQ0FBQyxPQUFPLENBQUMsQ0FBQTtRQUVyRSxJQUFJLGVBQWUsRUFBRSxDQUFDO1lBQ3BCLFVBQVUsQ0FBQyxJQUFJLENBQUMsRUFBQyxJQUFJLEVBQUUscUJBQXFCLEVBQUUsTUFBTSxFQUFFLGVBQWUsRUFBQyxDQUFDLENBQUE7WUFDdkUsVUFBVSxDQUFDLEtBQUssRUFBRSxDQUFBO1lBQ2xCLE9BQU8sSUFBSSxDQUFBO1FBQ2IsQ0FBQztRQUVELElBQUksT0FBTyxDQUFDLElBQUksS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUM5QixJQUFJLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztnQkFDbEIsVUFBVSxDQUFDLEtBQUssRUFBRSxDQUFBO2dCQUNsQixPQUFPLE9BQU8sQ0FBQyxJQUFJLENBQUE7WUFDckIsQ0FBQztZQUVELElBQUksQ0FBQyxDQUFDLE1BQU0sSUFBSSxDQUFDLGVBQWUsQ0FBQyxFQUFDLFVBQVUsRUFBRSxPQUFPLEVBQUMsQ0FBQyxDQUFDO2dCQUFFLE9BQU8sSUFBSSxDQUFBO1FBQ3ZFLENBQUM7UUFFRCxJQUFJLElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQztZQUN0QixVQUFVLENBQUMsSUFBSSxDQUFDO2dCQUNkLElBQUksRUFBRSxxQkFBcUI7Z0JBQzNCLFlBQVksRUFBRSxJQUFJLENBQUMsWUFBWTtnQkFDL0IsY0FBYyxFQUFFLElBQUksQ0FBQyxjQUFjO2FBQ3BDLENBQUMsQ0FBQTtZQUNGLElBQUksT0FBTyxDQUFDLElBQUksS0FBSyxRQUFRLElBQUksQ0FBQyxJQUFJLENBQUMsY0FBYyxLQUFLLFVBQVUsSUFBSSxJQUFJLENBQUMsY0FBYyxLQUFLLFNBQVMsQ0FBQyxFQUFFLENBQUM7Z0JBQzNHLFVBQVUsQ0FBQyxJQUFJLENBQUMsRUFBQyxJQUFJLEVBQUUsUUFBUSxFQUFFLFlBQVksRUFBRSxJQUFJLENBQUMsWUFBWSxFQUFDLENBQUMsQ0FBQTtZQUNwRSxDQUFDO1FBQ0gsQ0FBQztRQUVELE9BQU8sT0FBTyxDQUFDLElBQUksQ0FBQTtJQUNyQixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILCtCQUErQixDQUFDLE9BQU87UUFDckMsTUFBTSxvQkFBb0IsR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLE9BQU8sRUFBRSxjQUFjLENBQUMsQ0FBQTtRQUVuRSxJQUFJLENBQUMsSUFBSSxDQUFDLFlBQVk7WUFBRSxPQUFPLG9CQUFvQixDQUFDLENBQUMsQ0FBQyx1QkFBdUIsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFBO1FBQ3BGLElBQUksQ0FBQyxvQkFBb0I7WUFBRSxPQUFPLG9CQUFvQixDQUFBO1FBRXRELElBQUksQ0FBQztZQUNILG9CQUFvQixDQUFDLE9BQU8sQ0FBQyxZQUFZLEVBQUUsb0JBQW9CLENBQUMsQ0FBQTtRQUNsRSxDQUFDO1FBQUMsTUFBTSxDQUFDO1lBQ1AsT0FBTyxzQkFBc0IsQ0FBQTtRQUMvQixDQUFDO1FBRUQsSUFBSSxPQUFPLENBQUMsWUFBWSxLQUFLLElBQUksQ0FBQyxZQUFZO1lBQUUsT0FBTyxxQkFBcUIsQ0FBQTtRQUM1RSxJQUFJLE9BQU8sQ0FBQyxJQUFJLEtBQUssUUFBUSxJQUFJLENBQUMsMkJBQTJCLENBQUMsRUFBQyxZQUFZLEVBQUUsSUFBSSxDQUFDLFlBQVksRUFBRSxRQUFRLEVBQUUsT0FBTyxDQUFDLFFBQVEsRUFBQyxDQUFDLEVBQUUsQ0FBQztZQUM3SCxPQUFPLHFCQUFxQixDQUFBO1FBQzlCLENBQUM7UUFFRCxPQUFPLElBQUksQ0FBQTtJQUNiLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsZUFBZSxDQUFDLEVBQUMsVUFBVSxFQUFFLE9BQU8sRUFBQztRQUN6QyxVQUFVLENBQUMsUUFBUSxHQUFHLE9BQU8sQ0FBQyxRQUFRLENBQUE7UUFDdEMsVUFBVSxDQUFDLDBCQUEwQixHQUFHLE9BQU8sQ0FBQywwQkFBMEIsS0FBSyxJQUFJLENBQUE7UUFDbkYsVUFBVSxDQUFDLGlCQUFpQixHQUFHLE9BQU8sQ0FBQyxpQkFBaUIsS0FBSyxJQUFJLENBQUE7UUFDakUsVUFBVSxDQUFDLFVBQVUsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFBO1FBRXhDLE1BQU0sUUFBUSxHQUFHLFVBQVUsQ0FBQyxRQUFRLENBQUE7UUFDcEMsTUFBTSxZQUFZLEdBQUcsUUFBUSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsbUJBQW1CLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUE7UUFDbEYsSUFBSSxRQUFRLEdBQUcsWUFBWSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLEdBQUcsQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQTtRQUN0RixNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsY0FBYyxLQUFLLFVBQVUsSUFBSSxJQUFJLENBQUMsY0FBYyxLQUFLLFNBQVMsQ0FBQTtRQUU1RixJQUFJLFlBQVksSUFBSSxDQUFDLENBQUMsUUFBUSxJQUFJLFFBQVEsQ0FBQyxJQUFJLEtBQUssQ0FBQyxDQUFDLEVBQUUsQ0FBQztZQUN2RCxJQUFJLENBQUMsUUFBUTtnQkFBRSxPQUFPLEtBQUssQ0FBQTtZQUMzQixNQUFNLGVBQWUsR0FBRyxNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsc0JBQXNCLENBQUMsRUFBQyxRQUFRLEVBQUMsQ0FBQyxDQUFBO1lBRTNFLElBQUksZUFBZSxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUUsQ0FBQztnQkFDakMsVUFBVSxDQUFDLElBQUksQ0FBQyxFQUFDLElBQUksRUFBRSxxQkFBcUIsRUFBRSxNQUFNLEVBQUUsb0NBQW9DLEVBQUMsQ0FBQyxDQUFBO2dCQUM1RixVQUFVLENBQUMsS0FBSyxFQUFFLENBQUE7Z0JBQ2xCLE9BQU8sS0FBSyxDQUFBO1lBQ2QsQ0FBQztZQUVELFFBQVEsR0FBRyxJQUFJLEdBQUcsQ0FBQyxlQUFlLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBQyxLQUFLLEVBQUUsU0FBUyxFQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsS0FBSyxFQUFFLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQTtZQUNuRixJQUFJLENBQUMsb0JBQW9CLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBQ3pDLENBQUM7UUFFRCxJQUFJLFlBQVksRUFBRSxDQUFDO1lBQ2pCLElBQUksQ0FBQyxLQUFLLENBQUMsWUFBWSxDQUFDLFlBQVksQ0FBQyxLQUFLLENBQUMsQ0FBQTtZQUMzQyxJQUFJLFFBQVE7Z0JBQUUsSUFBSSxDQUFDLG1CQUFtQixDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsQ0FBQTtZQUN2RCxJQUFJLENBQUMsY0FBYyxDQUFDLE1BQU0sQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDakQsQ0FBQztRQUVELElBQUksQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBQzVCLElBQUksQ0FBQyxjQUFjLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxRQUFRLElBQUksSUFBSSxHQUFHLEVBQUUsQ0FBQyxDQUFBO1FBQzFELElBQUksWUFBWTtZQUFFLFVBQVUsQ0FBQyxVQUFVLEdBQUcsSUFBSSxDQUFBO1FBQzlDLElBQUksQ0FBQyxRQUFRLElBQUksSUFBSSxDQUFDLGNBQWMsS0FBSyxRQUFRO1lBQUUsSUFBSSxDQUFDLDJCQUEyQixDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBRS9GLE9BQU8sSUFBSSxDQUFBO0lBQ2IsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCwyQkFBMkIsQ0FBQyxVQUFVO1FBQ3BDLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUN0RCxJQUFJLENBQUMsOEJBQThCLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBQ2pELE1BQU0sY0FBYyxHQUFHLEdBQUcsRUFBRTtZQUMxQixJQUFJLENBQUMsOEJBQThCLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1lBQ3BELElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFBO1FBQzFCLENBQUMsQ0FBQTtRQUNELEtBQUssUUFBUSxDQUFDLElBQUksQ0FBQyxjQUFjLEVBQUUsY0FBYyxDQUFDLENBQUE7SUFDcEQsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyw0QkFBNEI7UUFDaEMsT0FBTyxJQUFJLENBQUMsOEJBQThCLENBQUMsSUFBSSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ3BELE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsSUFBSSxDQUFDLDhCQUE4QixDQUFDLENBQUMsQ0FBQTtRQUM3RCxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7Ozs7Ozs7O09BYUc7SUFDSCxLQUFLLENBQUMsb0JBQW9CLENBQUMsVUFBVTtRQUNuQyxNQUFNLFFBQVEsR0FBRyxVQUFVLENBQUMsUUFBUSxDQUFBO1FBRXBDLElBQUksT0FBTyxRQUFRLEtBQUssUUFBUSxJQUFJLFFBQVEsQ0FBQyxNQUFNLEtBQUssQ0FBQztZQUFFLE9BQU07UUFFakUsSUFBSSxDQUFDO1lBQ0gsTUFBTSxRQUFRLEdBQUcsTUFBTSxJQUFJLENBQUMsS0FBSyxDQUFDLHNCQUFzQixDQUFDLEVBQUMsUUFBUSxFQUFDLENBQUMsQ0FBQTtZQUNwRSxNQUFNLEdBQUcsR0FBRyxJQUFJLENBQUMsY0FBYyxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FBQTtZQUUvQyw0RUFBNEU7WUFDNUUsMkVBQTJFO1lBQzNFLElBQUksQ0FBQyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUM7Z0JBQUUsT0FBTTtZQUVqRCxLQUFLLE1BQU0sRUFBQyxLQUFLLEVBQUUsU0FBUyxFQUFDLElBQUksUUFBUSxFQUFFLENBQUM7Z0JBQzFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsS0FBSyxFQUFFLFNBQVMsQ0FBQyxDQUFBO1lBQzNCLENBQUM7WUFDRCxJQUFJLENBQUMsb0JBQW9CLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBQ3pDLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsSUFBSSxDQUFDLHdCQUF3QixDQUFDLEtBQUssQ0FBQyxDQUFBO1FBQ3RDLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLDBCQUEwQixDQUFDLEVBQUMsVUFBVSxFQUFFLE9BQU8sRUFBQztRQUNwRCxJQUFJLElBQUksQ0FBQyxZQUFZLElBQUksQ0FBQyxJQUFJLENBQUMsY0FBYyxLQUFLLFVBQVUsSUFBSSxJQUFJLENBQUMsY0FBYyxLQUFLLFNBQVMsQ0FBQyxFQUFFLENBQUM7WUFDbkcsSUFBSSxPQUFPLEVBQUUsSUFBSSxLQUFLLFNBQVMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxhQUFhO2dCQUFFLFVBQVUsQ0FBQyxJQUFJLENBQUMsRUFBQyxJQUFJLEVBQUUsZUFBZSxFQUFFLEtBQUssRUFBRSx1Q0FBdUMsRUFBQyxDQUFDLENBQUE7WUFDbkosSUFBSSxPQUFPLEVBQUUsSUFBSSxLQUFLLG1CQUFtQjtnQkFBRSxVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUMsSUFBSSxFQUFFLHlCQUF5QixFQUFFLEtBQUssRUFBRSx1Q0FBdUMsRUFBQyxDQUFDLENBQUE7WUFDN0ksSUFBSSxPQUFPLEVBQUUsSUFBSSxLQUFLLGtCQUFrQjtnQkFBRSxVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUMsSUFBSSxFQUFFLHdCQUF3QixFQUFFLEtBQUssRUFBRSx1Q0FBdUMsRUFBQyxDQUFDLENBQUE7WUFDM0ksSUFBSSxPQUFPLEVBQUUsSUFBSSxLQUFLLG1CQUFtQjtnQkFBRSxVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUMsSUFBSSxFQUFFLHlCQUF5QixFQUFFLEtBQUssRUFBRSx1Q0FBdUMsRUFBQyxDQUFDLENBQUE7WUFDN0ksSUFBSSxPQUFPLEVBQUUsSUFBSSxLQUFLLGdCQUFnQjtnQkFBRSxVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUMsSUFBSSxFQUFFLHNCQUFzQixFQUFFLEtBQUssRUFBRSx1Q0FBdUMsRUFBQyxDQUFDLENBQUE7WUFDdkksSUFBSSxPQUFPLEVBQUUsSUFBSSxLQUFLLFNBQVMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxhQUFhO2dCQUFFLE9BQU07UUFDbkUsQ0FBQztRQUVELElBQUksT0FBTyxFQUFFLElBQUksS0FBSyxTQUFTLEVBQUUsQ0FBQztZQUNoQyxNQUFNLElBQUksQ0FBQyxjQUFjLENBQUMsRUFBQyxVQUFVLEVBQUUsT0FBTyxFQUFDLENBQUMsQ0FBQTtZQUNoRCxPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksT0FBTyxFQUFFLElBQUksS0FBSyxtQkFBbUIsRUFBRSxDQUFDO1lBQzFDLE1BQU0sSUFBSSxDQUFDLHVCQUF1QixDQUFDLEVBQUMsVUFBVSxFQUFFLE9BQU8sRUFBQyxDQUFDLENBQUE7WUFDekQsT0FBTTtRQUNSLENBQUM7UUFFRCxJQUFJLE9BQU8sRUFBRSxJQUFJLEtBQUssa0JBQWtCLEVBQUUsQ0FBQztZQUN6QyxNQUFNLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxFQUFDLFVBQVUsRUFBRSxPQUFPLEVBQUMsQ0FBQyxDQUFBO1lBQ3hELE9BQU07UUFDUixDQUFDO1FBRUQsSUFBSSxPQUFPLEVBQUUsSUFBSSxLQUFLLG1CQUFtQixFQUFFLENBQUM7WUFDMUMsTUFBTSxJQUFJLENBQUMsc0JBQXNCLENBQUMsRUFBQyxVQUFVLEVBQUUsT0FBTyxFQUFDLENBQUMsQ0FBQTtZQUN4RCxPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksT0FBTyxFQUFFLElBQUksS0FBSyxnQkFBZ0IsRUFBRSxDQUFDO1lBQ3ZDLE1BQU0sSUFBSSxDQUFDLG9CQUFvQixDQUFDLEVBQUMsVUFBVSxFQUFFLE9BQU8sRUFBQyxDQUFDLENBQUE7UUFDeEQsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsMEJBQTBCLENBQUMsRUFBQyxVQUFVLEVBQUUsT0FBTyxFQUFDO1FBQ3BELDBFQUEwRTtRQUMxRSx5Q0FBeUM7UUFDekMsVUFBVSxDQUFDLFVBQVUsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFBO1FBRXhDLElBQUksT0FBTyxFQUFFLElBQUksS0FBSyxXQUFXLEVBQUUsQ0FBQztZQUNsQyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQyxVQUFVLENBQUMsQ0FBQTtZQUNwQyxPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksT0FBTyxFQUFFLElBQUksS0FBSyxPQUFPLEVBQUUsQ0FBQztZQUM5QixJQUFJLENBQUMsa0JBQWtCLENBQUMsRUFBQyxVQUFVLEVBQUUsT0FBTyxFQUFDLENBQUMsQ0FBQTtZQUM5QyxPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksT0FBTyxFQUFFLElBQUksS0FBSyxVQUFVLEVBQUUsQ0FBQztZQUNqQyxJQUFJLENBQUMscUJBQXFCLENBQUMsRUFBQyxVQUFVLEVBQUMsQ0FBQyxDQUFBO1lBQ3hDLE9BQU07UUFDUixDQUFDO1FBRUQsTUFBTSxJQUFJLENBQUMsNEJBQTRCLENBQUMsRUFBQyxVQUFVLEVBQUUsT0FBTyxFQUFDLENBQUMsQ0FBQTtJQUNoRSxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLDRCQUE0QixDQUFDLEVBQUMsVUFBVSxFQUFFLE9BQU8sRUFBQztRQUN0RCxJQUFJLElBQUksQ0FBQyxZQUFZLElBQUksSUFBSSxDQUFDLDBCQUEwQixDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7WUFDbEUsSUFBSSxPQUFPLElBQUksT0FBTyxJQUFJLE9BQU8sT0FBTyxDQUFDLEtBQUssS0FBSyxRQUFRLEVBQUUsQ0FBQztnQkFDNUQsVUFBVSxDQUFDLElBQUksQ0FBQyxFQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRSxLQUFLLEVBQUUsT0FBTyxDQUFDLEtBQUssRUFBRSxLQUFLLEVBQUUsK0JBQStCLEVBQUMsQ0FBQyxDQUFBO1lBQzNHLENBQUM7WUFDRCxPQUFNO1FBQ1IsQ0FBQztRQUNELElBQUksT0FBTyxFQUFFLElBQUksS0FBSyxjQUFjLEVBQUUsQ0FBQztZQUNyQyxNQUFNLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxFQUFDLFVBQVUsRUFBRSxPQUFPLEVBQUMsQ0FBQyxDQUFBO1lBQ3BELE9BQU07UUFDUixDQUFDO1FBRUQsSUFBSSxPQUFPLEVBQUUsSUFBSSxLQUFLLGNBQWMsRUFBRSxDQUFDO1lBQ3JDLE1BQU0sSUFBSSxDQUFDLGtCQUFrQixDQUFDLEVBQUMsVUFBVSxFQUFFLE9BQU8sRUFBQyxDQUFDLENBQUE7WUFDcEQsT0FBTTtRQUNSLENBQUM7UUFFRCxJQUFJLE9BQU8sRUFBRSxJQUFJLEtBQUssWUFBWSxFQUFFLENBQUM7WUFDbkMsTUFBTSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsRUFBQyxVQUFVLEVBQUUsT0FBTyxFQUFDLENBQUMsQ0FBQTtZQUNsRCxPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksT0FBTyxFQUFFLElBQUksS0FBSyxnQkFBZ0IsRUFBRSxDQUFDO1lBQ3ZDLE1BQU0sSUFBSSxDQUFDLG9CQUFvQixDQUFDLEVBQUMsVUFBVSxFQUFFLE9BQU8sRUFBQyxDQUFDLENBQUE7UUFDeEQsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7Ozs7O09BU0c7SUFDSCxLQUFLLENBQUMsa0JBQWtCLENBQUMsRUFBQyxVQUFVLEVBQUUsT0FBTyxFQUFDO1FBQzVDLElBQUksQ0FBQztZQUNILE1BQU0sSUFBSSxDQUFDLEtBQUssQ0FBQyxpQkFBaUIsQ0FBQztnQkFDakMsZUFBZSxFQUFFLE9BQU8sQ0FBQyxlQUFlO2dCQUN4QyxRQUFRLEVBQUUsT0FBTyxDQUFDLFFBQVE7Z0JBQzFCLGFBQWEsRUFBRSxPQUFPLENBQUMsYUFBYTtnQkFDcEMsU0FBUyxFQUFFLE9BQU8sQ0FBQyxTQUFTO2dCQUM1QixLQUFLLEVBQUUsT0FBTyxDQUFDLEtBQUs7Z0JBQ3BCLFlBQVksRUFBRSxPQUFPLENBQUMsWUFBWTtnQkFDbEMsV0FBVyxFQUFFLE9BQU8sQ0FBQyxXQUFXO2dCQUNoQyxRQUFRLEVBQUUsT0FBTyxDQUFDLFFBQVE7YUFDM0IsQ0FBQyxDQUFBO1lBQ0YsVUFBVSxDQUFDLElBQUksQ0FBQyxFQUFDLElBQUksRUFBRSxhQUFhLEVBQUUsS0FBSyxFQUFFLE9BQU8sQ0FBQyxLQUFLLEVBQUMsQ0FBQyxDQUFBO1FBQzlELENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsSUFBSSxDQUFDLHVCQUF1QixDQUFDLEVBQUMsS0FBSyxFQUFFLEtBQUssRUFBRSxPQUFPLENBQUMsS0FBSyxFQUFFLEtBQUssRUFBRSx5QkFBeUIsRUFBQyxDQUFDLENBQUE7WUFDN0YsVUFBVSxDQUFDLElBQUksQ0FBQyxFQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRSxLQUFLLEVBQUUsT0FBTyxDQUFDLEtBQUssRUFBRSxLQUFLLEVBQUUsc0JBQXNCLEVBQUMsQ0FBQyxDQUFBO1FBQ2xHLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCwwQkFBMEIsQ0FBQyxPQUFPO1FBQ2hDLElBQUksT0FBTyxFQUFFLElBQUksS0FBSyxjQUFjLElBQUksT0FBTyxFQUFFLElBQUksS0FBSyxjQUFjLElBQUksT0FBTyxFQUFFLElBQUksS0FBSyxZQUFZLElBQUksT0FBTyxFQUFFLElBQUksS0FBSyxnQkFBZ0I7WUFBRSxPQUFPLEtBQUssQ0FBQTtRQUM5SixNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsWUFBWSxDQUFBO1FBQ3RDLElBQUksQ0FBQyxZQUFZO1lBQUUsT0FBTyxLQUFLLENBQUE7UUFFL0IsT0FBTyxPQUFPLE9BQU8sQ0FBQyxTQUFTLEtBQUssUUFBUTtlQUN2QyxPQUFPLE9BQU8sQ0FBQyxhQUFhLEtBQUssUUFBUTtlQUN6QyxDQUFDLDJCQUEyQixDQUFDLEVBQUMsWUFBWSxFQUFFLFFBQVEsRUFBRSxPQUFPLENBQUMsUUFBUSxFQUFDLENBQUMsQ0FBQTtJQUMvRSxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsa0JBQWtCLENBQUMsRUFBQyxVQUFVLEVBQUUsT0FBTyxFQUFDO1FBQ3RDLElBQUksSUFBSSxDQUFDLGNBQWMsS0FBSyxVQUFVLElBQUksSUFBSSxDQUFDLGNBQWMsS0FBSyxTQUFTLEVBQUUsQ0FBQztZQUM1RSxJQUFJLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQTtZQUNwQyxJQUFJLENBQUMscUJBQXFCLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFBO1lBQzdDLE9BQU07UUFDUixDQUFDO1FBRUQsVUFBVSxDQUFDLGdCQUFnQixJQUFJLENBQUMsQ0FBQTtRQUNoQyxVQUFVLENBQUMsa0JBQWtCLEdBQUcsT0FBTyxDQUFDLGNBQWMsS0FBSyxLQUFLLElBQUksT0FBTyxDQUFDLGFBQWEsS0FBSyxLQUFLLENBQUE7UUFDbkcsVUFBVSxDQUFDLGlCQUFpQixHQUFHLE9BQU8sQ0FBQyxhQUFhLEtBQUssS0FBSyxDQUFBO1FBQzlELFVBQVUsQ0FBQyxpQkFBaUIsR0FBRyxPQUFPLENBQUMsYUFBYSxLQUFLLElBQUksQ0FBQTtRQUM3RCxNQUFNLG9CQUFvQixHQUFHLE9BQU8sQ0FBQyxvQkFBb0IsQ0FBQTtRQUN6RCxVQUFVLENBQUMseUJBQXlCLEdBQUcsTUFBTSxDQUFDLFNBQVMsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFBO1FBQzdFLFVBQVUsQ0FBQyxvQkFBb0IsR0FBRyxNQUFNLENBQUMsU0FBUyxDQUFDLG9CQUFvQixDQUFDLElBQUksb0JBQW9CLEtBQUssU0FBUyxJQUFJLG9CQUFvQixHQUFHLENBQUM7WUFDeEksQ0FBQyxDQUFDLG9CQUFvQjtZQUN0QixDQUFDLENBQUMsQ0FBQyxDQUFBO1FBQ0wsVUFBVSxDQUFDLGlCQUFpQixHQUFHLE9BQU8sQ0FBQyxhQUFhLEtBQUssS0FBSyxDQUFBO1FBQzlELElBQUksSUFBSSxDQUFDLGNBQWMsS0FBSyxXQUFXLEVBQUUsQ0FBQztZQUN4QyxJQUFJLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQTtZQUNwQyxJQUFJLENBQUMsVUFBVSxDQUFDLFVBQVU7Z0JBQUUsSUFBSSxDQUFDLHFCQUFxQixDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUN4RSxDQUFDO2FBQU0sSUFBSSxJQUFJLENBQUMsY0FBYyxLQUFLLFFBQVEsSUFBSSxJQUFJLENBQUMscUJBQXFCLElBQUksVUFBVSxDQUFDLDBCQUEwQixJQUFJLENBQUMsVUFBVSxDQUFDLFVBQVUsRUFBRSxDQUFDO1lBQzdJLElBQUksQ0FBQyxZQUFZLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBQ25DLENBQUM7YUFBTSxDQUFDO1lBQ04sSUFBSSxDQUFDLFlBQVksQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUE7WUFDcEMsSUFBSSxDQUFDLHFCQUFxQixDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUMvQyxDQUFDO1FBQ0QsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBQ2hDLEtBQUssSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFBO0lBQ3BCLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILHFCQUFxQixDQUFDLEVBQUMsVUFBVSxFQUFDO1FBQ2hDLG9FQUFvRTtRQUNwRSxrRUFBa0U7UUFDbEUsNkNBQTZDO1FBQzdDLFVBQVUsQ0FBQyxVQUFVLEdBQUcsSUFBSSxDQUFBO1FBQzVCLElBQUksQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBQ3BDLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUE7SUFDL0MsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyx5QkFBeUIsQ0FBQyxNQUFNLEVBQUUsRUFBQyxZQUFZLEdBQUcsS0FBSyxFQUFDLEdBQUcsRUFBRTtRQUNqRSxJQUFJLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUMzQixJQUFJLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUNoQyxJQUFJLENBQUMscUJBQXFCLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBRXpDLElBQUksSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBQ2xCLElBQUksQ0FBQyxjQUFjLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1lBQ2xDLE9BQU07UUFDUixDQUFDO1FBRUQsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLGNBQWMsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDaEQsSUFBSSxJQUFJLENBQUMsWUFBWSxJQUFJLE1BQU0sQ0FBQyxRQUFRLElBQUksUUFBUSxJQUFJLFFBQVEsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDMUUsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLG1CQUFtQixDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUE7WUFDOUQsSUFBSSxRQUFRLEVBQUUsTUFBTSxLQUFLLE1BQU07Z0JBQUUsT0FBTTtZQUN2QyxJQUFJLFFBQVE7Z0JBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxZQUFZLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFBO1lBRXJELE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLEdBQUcsRUFBRTtnQkFDdkMsSUFBSSxDQUFDLG1CQUFtQixDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsUUFBUSxJQUFJLEVBQUUsQ0FBQyxDQUFBO2dCQUN0RCxLQUFLLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxNQUFNLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFO29CQUNqRCxJQUFJLE1BQU0sQ0FBQyxRQUFRO3dCQUFFLElBQUksQ0FBQyx3QkFBd0IsRUFBRSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsQ0FBQTtnQkFDdkUsQ0FBQyxFQUFFLENBQUMsS0FBSyxFQUFFLEVBQUU7b0JBQ1gsSUFBSSxDQUFDLDBCQUEwQixDQUFDLEtBQUssQ0FBQyxDQUFBO29CQUN0QyxJQUFJLENBQUMsbUJBQW1CLEVBQUUsQ0FBQTtnQkFDNUIsQ0FBQyxDQUFDLENBQUE7WUFDSixDQUFDLEVBQUUsSUFBSSxDQUFDLHNCQUFzQixDQUFDLENBQUE7WUFDL0IsSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRO2dCQUFFLEtBQUssQ0FBQyxLQUFLLEVBQUUsQ0FBQTtZQUM1QyxJQUFJLENBQUMsbUJBQW1CLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxRQUFRLEVBQUUsRUFBQyxNQUFNLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtZQUM5RCxJQUFJLENBQUMsb0JBQW9CLEVBQUUsQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUE7WUFDNUMsT0FBTTtRQUNSLENBQUM7UUFFRCxJQUFJLENBQUM7WUFDSCxNQUFNLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxNQUFNLEVBQUUsRUFBQyxZQUFZLEVBQUMsQ0FBQyxDQUFBO1FBQzNELENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsSUFBSSxDQUFDLDBCQUEwQixDQUFDLEtBQUssQ0FBQyxDQUFBO1lBQ3RDLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxDQUFBO1FBQzVCLENBQUM7UUFDRCxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtJQUMxQixDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLHNCQUFzQixDQUFDLE1BQU0sRUFBRSxFQUFDLFlBQVksR0FBRyxLQUFLLEVBQUMsR0FBRyxFQUFFO1FBQzlELE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxjQUFjLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBRWhELElBQUksQ0FBQyxRQUFRLElBQUksUUFBUSxDQUFDLElBQUksS0FBSyxDQUFDLEVBQUUsQ0FBQztZQUNyQyxJQUFJLENBQUMsY0FBYyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQTtZQUNsQyxPQUFNO1FBQ1IsQ0FBQztRQUVELEtBQUssTUFBTSxDQUFDLEtBQUssRUFBRSxTQUFTLENBQUMsSUFBSSxRQUFRLEVBQUUsQ0FBQztZQUMxQyxNQUFNLElBQUksQ0FBQyxlQUFlLENBQUMsRUFBQyxTQUFTLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBQyxDQUFDLENBQUE7UUFDeEQsQ0FBQztRQUVELElBQUksQ0FBQyxjQUFjLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBQ2xDLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQTtRQUN0QixJQUFJLFlBQVksRUFBRSxDQUFDO1lBQ2pCLElBQUksQ0FBQyxjQUFjLEdBQUcsSUFBSSxDQUFBO1FBQzVCLENBQUM7YUFBTSxDQUFDO1lBQ04sSUFBSSxJQUFJLENBQUMsY0FBYyxLQUFLLFFBQVE7Z0JBQUUsTUFBTSxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUE7UUFDM0QsQ0FBQztRQUNELElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFBO0lBQzFCLENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsS0FBSyxDQUFDLGVBQWUsQ0FBQyxFQUFDLFNBQVMsRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFDO1FBQzlDLE1BQU0sSUFBSSxDQUFDLEtBQUssQ0FBQyxtQkFBbUIsQ0FBQyxFQUFDLFNBQVMsRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1FBRXhELE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxjQUFjLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBRWhELElBQUksUUFBUSxFQUFFLEdBQUcsQ0FBQyxLQUFLLENBQUMsS0FBSyxTQUFTO1lBQUUsUUFBUSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQTtJQUNoRSxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsY0FBYyxDQUFDLEVBQUMsU0FBUyxFQUFFLEtBQUssRUFBQztRQUMvQixLQUFLLE1BQU0sQ0FBQyxNQUFNLEVBQUUsUUFBUSxDQUFDLElBQUksSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO1lBQ3JELElBQUksUUFBUSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsS0FBSyxTQUFTO2dCQUFFLFNBQVE7WUFFL0MsUUFBUSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQTtZQUN0QixJQUFJLFFBQVEsQ0FBQyxJQUFJLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDO2dCQUFFLElBQUksQ0FBQyxjQUFjLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1lBQ3hGLElBQUksUUFBUSxDQUFDLElBQUksS0FBSyxDQUFDLElBQUksTUFBTSxDQUFDLFFBQVEsRUFBRSxDQUFDO2dCQUMzQyxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsbUJBQW1CLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsQ0FBQTtnQkFDbEUsSUFBSSxZQUFZLEVBQUUsTUFBTSxLQUFLLE1BQU0sRUFBRSxDQUFDO29CQUNwQyxJQUFJLENBQUMsS0FBSyxDQUFDLFlBQVksQ0FBQyxZQUFZLENBQUMsS0FBSyxDQUFDLENBQUE7b0JBQzNDLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFBO2dCQUNsRCxDQUFDO1lBQ0gsQ0FBQztZQUNELElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFBO1lBQ3hCLE9BQU07UUFDUixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCwwQkFBMEIsQ0FBQyxLQUFLO1FBQzlCLE1BQU0sZUFBZSxHQUFHLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsSUFBSSxLQUFLLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUE7UUFDakYsTUFBTSxPQUFPLEdBQUcsRUFBQyxPQUFPLEVBQUUsRUFBQyxLQUFLLEVBQUUsZ0NBQWdDLEVBQUMsRUFBRSxLQUFLLEVBQUUsZUFBZSxFQUFDLENBQUE7UUFDNUYsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxjQUFjLEVBQUUsQ0FBQTtRQUV2RCxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLGlEQUFpRCxFQUFFLGVBQWUsQ0FBQyxDQUFDLENBQUE7UUFDN0YsV0FBVyxDQUFDLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxPQUFPLENBQUMsQ0FBQTtRQUM1QyxXQUFXLENBQUMsSUFBSSxDQUFDLFdBQVcsRUFBRSxFQUFDLEdBQUcsT0FBTyxFQUFFLFNBQVMsRUFBRSxpQkFBaUIsRUFBQyxDQUFDLENBQUE7SUFDM0UsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILHdCQUF3QixDQUFDLEtBQUs7UUFDNUIsTUFBTSxlQUFlLEdBQUcsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQTtRQUNqRixNQUFNLE9BQU8sR0FBRyxFQUFDLE9BQU8sRUFBRSxFQUFDLEtBQUssRUFBRSw4QkFBOEIsRUFBQyxFQUFFLEtBQUssRUFBRSxlQUFlLEVBQUMsQ0FBQTtRQUMxRixNQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLGNBQWMsRUFBRSxDQUFBO1FBRXZELElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsOENBQThDLEVBQUUsZUFBZSxDQUFDLENBQUMsQ0FBQTtRQUMxRixXQUFXLENBQUMsSUFBSSxDQUFDLGlCQUFpQixFQUFFLE9BQU8sQ0FBQyxDQUFBO1FBQzVDLFdBQVcsQ0FBQyxJQUFJLENBQUMsV0FBVyxFQUFFLEVBQUMsR0FBRyxPQUFPLEVBQUUsU0FBUyxFQUFFLGlCQUFpQixFQUFDLENBQUMsQ0FBQTtJQUMzRSxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxpQ0FBaUMsQ0FBQyxLQUFLO1FBQ3JDLE1BQU0sZUFBZSxHQUFHLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsSUFBSSxLQUFLLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUE7UUFDakYsTUFBTSxPQUFPLEdBQUcsRUFBQyxPQUFPLEVBQUUsRUFBQyxLQUFLLEVBQUUsd0NBQXdDLEVBQUMsRUFBRSxLQUFLLEVBQUUsZUFBZSxFQUFDLENBQUE7UUFDcEcsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxjQUFjLEVBQUUsQ0FBQTtRQUV2RCxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLGtEQUFrRCxFQUFFLGVBQWUsQ0FBQyxDQUFDLENBQUE7UUFDOUYsV0FBVyxDQUFDLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxPQUFPLENBQUMsQ0FBQTtRQUM1QyxXQUFXLENBQUMsSUFBSSxDQUFDLFdBQVcsRUFBRSxFQUFDLEdBQUcsT0FBTyxFQUFFLFNBQVMsRUFBRSxpQkFBaUIsRUFBQyxDQUFDLENBQUE7SUFDM0UsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyxjQUFjLENBQUMsRUFBQyxVQUFVLEVBQUUsT0FBTyxFQUFDO1FBQ3hDLElBQUksQ0FBQztZQUNILElBQUksSUFBSSxDQUFDLFlBQVk7bUJBQ2hCLE9BQU8sT0FBTyxDQUFDLGFBQWEsRUFBRSxRQUFRLEtBQUssUUFBUTttQkFDbkQsQ0FBQywyQkFBMkIsQ0FBQyxFQUFDLFlBQVksRUFBRSxJQUFJLENBQUMsWUFBWSxFQUFFLFFBQVEsRUFBRSxPQUFPLENBQUMsYUFBYSxDQUFDLFFBQVEsRUFBQyxDQUFDLEVBQUUsQ0FBQztnQkFDL0csTUFBTSxjQUFjLENBQUMsSUFBSSxDQUFDLGdFQUFnRSxFQUFFO29CQUMxRixJQUFJLEVBQUUsNkNBQTZDO2lCQUNwRCxDQUFDLENBQUE7WUFDSixDQUFDO1lBRUQsTUFBTSxPQUFPLEdBQUc7Z0JBQ2QsT0FBTyxFQUFFLE9BQU8sQ0FBQyxPQUFPO2dCQUN4QixJQUFJLEVBQUUsT0FBTyxDQUFDLElBQUksSUFBSSxFQUFFO2dCQUN4QixPQUFPLEVBQUUsT0FBTyxDQUFDLE9BQU8sSUFBSSxFQUFFO2FBQy9CLENBQUE7WUFDRCxNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsWUFBWSxJQUFJLE9BQU8sQ0FBQyxhQUFhO2dCQUN0RCxDQUFDLENBQUMsTUFBTSxJQUFJLENBQUMsS0FBSyxDQUFDLHVCQUF1QixDQUFDLEVBQUMsR0FBRyxPQUFPLEVBQUUsb0JBQW9CLEVBQUUsT0FBTyxDQUFDLG9CQUFvQixFQUFFLGFBQWEsRUFBRSxPQUFPLENBQUMsYUFBYSxFQUFDLENBQUM7Z0JBQ2xKLENBQUMsQ0FBQyxNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFBO1lBRXJDLFVBQVUsQ0FBQyxJQUFJLENBQUMsRUFBQyxJQUFJLEVBQUUsVUFBVSxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7WUFDMUMsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFBO1lBQ3RCLElBQUksSUFBSSxDQUFDLGNBQWMsS0FBSyxRQUFRO2dCQUFFLE1BQU0sSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFBO1FBQzNELENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsSUFBSSxDQUFDLDBCQUEwQixDQUFDO2dCQUM5QixPQUFPLEVBQUUsRUFBQyxPQUFPLEVBQUUsT0FBTyxDQUFDLE9BQU8sRUFBRSxLQUFLLEVBQUUsd0JBQXdCLEVBQUM7Z0JBQ3BFLEtBQUs7Z0JBQ0wsZUFBZSxFQUFFLHVCQUF1QjtnQkFDeEMsVUFBVTtnQkFDVixVQUFVLEVBQUUsbUNBQW1DO2dCQUMvQyxZQUFZLEVBQUUsZUFBZTthQUM5QixDQUFDLENBQUE7UUFDSixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyx1QkFBdUIsQ0FBQyxFQUFDLFVBQVUsRUFBRSxPQUFPLEVBQUM7UUFDakQsSUFBSSxDQUFDO1lBQ0gsTUFBTSxNQUFNLEdBQUcsTUFBTSxJQUFJLENBQUMsS0FBSyxDQUFDLGdCQUFnQixDQUFDO2dCQUMvQyxXQUFXLEVBQUUsT0FBTyxDQUFDLFdBQVc7Z0JBQ2hDLE9BQU8sRUFBRSxPQUFPLENBQUMsT0FBTztnQkFDeEIsSUFBSSxFQUFFLE9BQU8sQ0FBQyxJQUFJLElBQUksRUFBRTtnQkFDeEIsT0FBTyxFQUFFLE9BQU8sQ0FBQyxPQUFPLElBQUksRUFBRTthQUMvQixDQUFDLENBQUE7WUFFRixJQUFJLENBQUMsZUFBZSxFQUFFLENBQUE7WUFDdEIsTUFBTSxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUE7WUFDbkIsVUFBVSxDQUFDLElBQUksQ0FBQyxFQUFDLElBQUksRUFBRSxtQkFBbUIsRUFBRSxHQUFHLE1BQU0sRUFBQyxDQUFDLENBQUE7UUFDekQsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixJQUFJLENBQUMsMEJBQTBCLENBQUM7Z0JBQzlCLE9BQU8sRUFBRSxFQUFDLE9BQU8sRUFBRSxPQUFPLENBQUMsT0FBTyxFQUFFLFdBQVcsRUFBRSxPQUFPLENBQUMsV0FBVyxFQUFFLEtBQUssRUFBRSxrQ0FBa0MsRUFBQztnQkFDaEgsS0FBSztnQkFDTCxlQUFlLEVBQUUsaUNBQWlDO2dCQUNsRCxVQUFVO2dCQUNWLFVBQVUsRUFBRSw2Q0FBNkM7Z0JBQ3pELFlBQVksRUFBRSx5QkFBeUI7YUFDeEMsQ0FBQyxDQUFBO1FBQ0osQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsc0JBQXNCLENBQUMsRUFBQyxVQUFVLEVBQUUsT0FBTyxFQUFDO1FBQ2hELElBQUksQ0FBQztZQUNILE1BQU0sTUFBTSxHQUFHLE1BQU0sSUFBSSxDQUFDLEtBQUssQ0FBQyxlQUFlLENBQUMsT0FBTyxDQUFDLFdBQVcsQ0FBQyxDQUFBO1lBRXBFLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQTtZQUN0QixNQUFNLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQTtZQUNuQixVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUMsSUFBSSxFQUFFLG9CQUFvQixFQUFFLEdBQUcsTUFBTSxFQUFDLENBQUMsQ0FBQTtRQUMxRCxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLElBQUksQ0FBQywwQkFBMEIsQ0FBQztnQkFDOUIsT0FBTyxFQUFFLEVBQUMsV0FBVyxFQUFFLE9BQU8sQ0FBQyxXQUFXLEVBQUUsS0FBSyxFQUFFLGlDQUFpQyxFQUFDO2dCQUNyRixLQUFLO2dCQUNMLGVBQWUsRUFBRSxnQ0FBZ0M7Z0JBQ2pELFVBQVU7Z0JBQ1YsVUFBVSxFQUFFLDRDQUE0QztnQkFDeEQsWUFBWSxFQUFFLHdCQUF3QjthQUN2QyxDQUFDLENBQUE7UUFDSixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyxzQkFBc0IsQ0FBQyxFQUFDLFVBQVUsRUFBRSxPQUFPLEVBQUM7UUFDaEQsSUFBSSxDQUFDO1lBQ0gsTUFBTSxNQUFNLEdBQUcsTUFBTSxJQUFJLENBQUMsS0FBSyxDQUFDLGVBQWUsQ0FBQyxPQUFPLENBQUMsV0FBVyxFQUFFO2dCQUNuRSxxQkFBcUIsRUFBRSxPQUFPLENBQUMscUJBQXFCO2FBQ3JELENBQUMsQ0FBQTtZQUVGLFVBQVUsQ0FBQyxJQUFJLENBQUMsRUFBQyxJQUFJLEVBQUUsZUFBZSxFQUFFLEdBQUcsTUFBTSxFQUFDLENBQUMsQ0FBQTtRQUNyRCxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLElBQUksQ0FBQywwQkFBMEIsQ0FBQztnQkFDOUIsT0FBTyxFQUFFLEVBQUMsV0FBVyxFQUFFLE9BQU8sQ0FBQyxXQUFXLEVBQUUsS0FBSyxFQUFFLDhCQUE4QixFQUFDO2dCQUNsRixLQUFLO2dCQUNMLGVBQWUsRUFBRSw4QkFBOEI7Z0JBQy9DLFVBQVU7Z0JBQ1YsVUFBVSxFQUFFLDBDQUEwQztnQkFDdEQsWUFBWSxFQUFFLHlCQUF5QjthQUN4QyxDQUFDLENBQUE7UUFDSixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyxvQkFBb0IsQ0FBQyxFQUFDLFVBQVUsRUFBRSxPQUFPLEVBQUM7UUFDOUMsSUFBSSxDQUFDO1lBQ0gsTUFBTSxNQUFNLEdBQUcsTUFBTSxJQUFJLENBQUMsS0FBSyxDQUFDLGFBQWEsQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDLENBQUE7WUFFbEUsSUFBSSxNQUFNLENBQUMsT0FBTyxLQUFLLE9BQU8sSUFBSSxNQUFNLENBQUMsT0FBTyxLQUFLLGFBQWEsRUFBRSxDQUFDO2dCQUNuRSxJQUFJLENBQUMsZUFBZSxFQUFFLENBQUE7Z0JBQ3RCLE1BQU0sSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFBO1lBQ3JCLENBQUM7WUFFRCxVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUMsSUFBSSxFQUFFLGdCQUFnQixFQUFFLEdBQUcsTUFBTSxFQUFDLENBQUMsQ0FBQTtRQUN0RCxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLElBQUksQ0FBQywwQkFBMEIsQ0FBQztnQkFDOUIsT0FBTyxFQUFFLEVBQUMsV0FBVyxFQUFFLE9BQU8sQ0FBQyxXQUFXLEVBQUUsS0FBSyxFQUFFLCtCQUErQixFQUFDO2dCQUNuRixLQUFLO2dCQUNMLGVBQWUsRUFBRSw4QkFBOEI7Z0JBQy9DLFVBQVU7Z0JBQ1YsVUFBVSxFQUFFLDBDQUEwQztnQkFDdEQsWUFBWSxFQUFFLHNCQUFzQjthQUNyQyxDQUFDLENBQUE7UUFDSixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7Ozs7O09BVUc7SUFDSCwwQkFBMEIsQ0FBQyxFQUFDLE9BQU8sRUFBRSxLQUFLLEVBQUUsZUFBZSxFQUFFLFVBQVUsRUFBRSxVQUFVLEVBQUUsWUFBWSxFQUFDO1FBQ2hHLElBQUksS0FBSyxZQUFZLGNBQWMsSUFBSSxLQUFLLENBQUMsWUFBWSxFQUFFLENBQUM7WUFDMUQsVUFBVSxDQUFDLElBQUksQ0FBQyxFQUFDLElBQUksRUFBRSxZQUFZLEVBQUUsS0FBSyxFQUFFLEtBQUssQ0FBQyxPQUFPLEVBQUMsQ0FBQyxDQUFBO1lBQzNELE9BQU07UUFDUixDQUFDO1FBRUQsTUFBTSxlQUFlLEdBQUcsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQTtRQUNqRixNQUFNLE9BQU8sR0FBRyxFQUFDLE9BQU8sRUFBRSxLQUFLLEVBQUUsZUFBZSxFQUFDLENBQUE7UUFDakQsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxjQUFjLEVBQUUsQ0FBQTtRQUV2RCxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLFVBQVUsRUFBRSxlQUFlLENBQUMsQ0FBQyxDQUFBO1FBQ3RELFdBQVcsQ0FBQyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsT0FBTyxDQUFDLENBQUE7UUFDNUMsV0FBVyxDQUFDLElBQUksQ0FBQyxXQUFXLEVBQUUsRUFBQyxHQUFHLE9BQU8sRUFBRSxTQUFTLEVBQUUsaUJBQWlCLEVBQUMsQ0FBQyxDQUFBO1FBQ3pFLFVBQVUsQ0FBQyxJQUFJLENBQUMsRUFBQyxJQUFJLEVBQUUsWUFBWSxFQUFFLEtBQUssRUFBRSxlQUFlLEVBQUMsQ0FBQyxDQUFBO0lBQy9ELENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsa0JBQWtCLENBQUMsRUFBQyxVQUFVLEVBQUUsT0FBTyxFQUFDO1FBQzVDLElBQUksQ0FBQztZQUNILE1BQU0sUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDLEtBQUssQ0FBQyxhQUFhLENBQUM7Z0JBQzlDLEtBQUssRUFBRSxPQUFPLENBQUMsS0FBSztnQkFDcEIsU0FBUyxFQUFFLE9BQU8sQ0FBQyxTQUFTO2dCQUM1QixRQUFRLEVBQUUsT0FBTyxDQUFDLFFBQVE7Z0JBQzFCLGFBQWEsRUFBRSxPQUFPLENBQUMsYUFBYTthQUNyQyxDQUFDLENBQUE7WUFDRixJQUFJLFFBQVEsSUFBSSxPQUFPLENBQUMsU0FBUyxFQUFFLENBQUM7Z0JBQ2xDLElBQUksQ0FBQyxjQUFjLENBQUMsRUFBQyxTQUFTLEVBQUUsT0FBTyxDQUFDLFNBQVMsRUFBRSxLQUFLLEVBQUUsT0FBTyxDQUFDLEtBQUssRUFBQyxDQUFDLENBQUE7WUFDM0UsQ0FBQztZQUNELElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQyxFQUFDLFFBQVEsRUFBRSxLQUFLLEVBQUUsT0FBTyxDQUFDLEtBQUssRUFBRSxNQUFNLEVBQUUsV0FBVyxFQUFDLENBQUMsQ0FBQTtZQUMxRSxVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUMsSUFBSSxFQUFFLGFBQWEsRUFBRSxLQUFLLEVBQUUsT0FBTyxDQUFDLEtBQUssRUFBQyxDQUFDLENBQUE7UUFDOUQsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixJQUFJLENBQUMsdUJBQXVCLENBQUMsRUFBQyxLQUFLLEVBQUUsS0FBSyxFQUFFLE9BQU8sQ0FBQyxLQUFLLEVBQUUsS0FBSyxFQUFFLHlCQUF5QixFQUFDLENBQUMsQ0FBQTtZQUM3RixVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFLEtBQUssRUFBRSxPQUFPLENBQUMsS0FBSyxFQUFFLEtBQUssRUFBRSxzQkFBc0IsRUFBQyxDQUFDLENBQUE7UUFDbEcsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsdUJBQXVCLENBQUMsRUFBQyxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBQztRQUMzQyxNQUFNLGVBQWUsR0FBRyxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLElBQUksS0FBSyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFBO1FBQ2pGLE1BQU0sT0FBTyxHQUFHLEVBQUMsT0FBTyxFQUFFLEVBQUMsWUFBWSxFQUFFLElBQUksQ0FBQyxZQUFZLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBQyxFQUFFLEtBQUssRUFBRSxlQUFlLEVBQUMsQ0FBQTtRQUNsRyxNQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLGNBQWMsRUFBRSxDQUFBO1FBRXZELElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsa0NBQWtDLEVBQUUsZUFBZSxDQUFDLENBQUMsQ0FBQTtRQUM5RSxXQUFXLENBQUMsSUFBSSxDQUFDLGlCQUFpQixFQUFFLE9BQU8sQ0FBQyxDQUFBO1FBQzVDLFdBQVcsQ0FBQyxJQUFJLENBQUMsV0FBVyxFQUFFLEVBQUMsR0FBRyxPQUFPLEVBQUUsU0FBUyxFQUFFLGlCQUFpQixFQUFDLENBQUMsQ0FBQTtJQUMzRSxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLG9CQUFvQixDQUFDLEVBQUMsVUFBVSxFQUFFLE9BQU8sRUFBQztRQUM5QyxJQUFJLENBQUM7WUFDSCxNQUFNLFFBQVEsR0FBRyxNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsZUFBZSxDQUFDO2dCQUNoRCxLQUFLLEVBQUUsT0FBTyxDQUFDLEtBQUs7Z0JBQ3BCLE9BQU8sRUFBRSxPQUFPLENBQUMsT0FBTztnQkFDeEIsU0FBUyxFQUFFLE9BQU8sQ0FBQyxTQUFTO2dCQUM1QixRQUFRLEVBQUUsT0FBTyxDQUFDLFFBQVE7Z0JBQzFCLGFBQWEsRUFBRSxPQUFPLENBQUMsYUFBYTthQUNyQyxDQUFDLENBQUE7WUFDRixJQUFJLFFBQVEsSUFBSSxPQUFPLENBQUMsU0FBUyxFQUFFLENBQUM7Z0JBQ2xDLElBQUksQ0FBQyxjQUFjLENBQUMsRUFBQyxTQUFTLEVBQUUsT0FBTyxDQUFDLFNBQVMsRUFBRSxLQUFLLEVBQUUsT0FBTyxDQUFDLEtBQUssRUFBQyxDQUFDLENBQUE7WUFDM0UsQ0FBQztZQUNELElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQyxFQUFDLFFBQVEsRUFBRSxLQUFLLEVBQUUsT0FBTyxDQUFDLEtBQUssRUFBRSxNQUFNLEVBQUUsYUFBYSxFQUFDLENBQUMsQ0FBQTtZQUM1RSxVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUMsSUFBSSxFQUFFLGFBQWEsRUFBRSxLQUFLLEVBQUUsT0FBTyxDQUFDLEtBQUssRUFBQyxDQUFDLENBQUE7WUFDNUQsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFBO1lBQ3RCLE1BQU0sSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFBO1FBQ3JCLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsTUFBTSxlQUFlLEdBQUcsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQTtZQUNqRixNQUFNLE9BQU8sR0FBRyxFQUFDLE9BQU8sRUFBRSxFQUFDLEtBQUssRUFBRSxPQUFPLENBQUMsS0FBSyxFQUFFLEtBQUssRUFBRSwyQkFBMkIsRUFBQyxFQUFFLEtBQUssRUFBRSxlQUFlLEVBQUMsQ0FBQTtZQUM3RyxNQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLGNBQWMsRUFBRSxDQUFBO1lBRXZELElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsa0NBQWtDLEVBQUUsZUFBZSxDQUFDLENBQUMsQ0FBQTtZQUM5RSxXQUFXLENBQUMsSUFBSSxDQUFDLGlCQUFpQixFQUFFLE9BQU8sQ0FBQyxDQUFBO1lBQzVDLFdBQVcsQ0FBQyxJQUFJLENBQUMsV0FBVyxFQUFFLEVBQUMsR0FBRyxPQUFPLEVBQUUsU0FBUyxFQUFFLGlCQUFpQixFQUFDLENBQUMsQ0FBQTtZQUN6RSxVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFLEtBQUssRUFBRSxPQUFPLENBQUMsS0FBSyxFQUFFLEtBQUssRUFBRSxzQkFBc0IsRUFBQyxDQUFDLENBQUE7UUFDbEcsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsZ0JBQWdCLENBQUMsRUFBQyxVQUFVLEVBQUUsT0FBTyxFQUFDO1FBQzFDLElBQUksQ0FBQztZQUNILE1BQU0sU0FBUyxHQUFHLE1BQU0sSUFBSSxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUM7Z0JBQzVDLEtBQUssRUFBRSxPQUFPLENBQUMsS0FBSztnQkFDcEIsS0FBSyxFQUFFLE9BQU8sQ0FBQyxLQUFLO2dCQUNwQixTQUFTLEVBQUUsT0FBTyxDQUFDLFNBQVM7Z0JBQzVCLFFBQVEsRUFBRSxPQUFPLENBQUMsUUFBUTtnQkFDMUIsYUFBYSxFQUFFLE9BQU8sQ0FBQyxhQUFhO2FBQ3JDLENBQUMsQ0FBQTtZQUVGLElBQUksU0FBUyxFQUFFLENBQUM7Z0JBQ2QsSUFBSSxPQUFPLENBQUMsU0FBUyxFQUFFLENBQUM7b0JBQ3RCLElBQUksQ0FBQyxjQUFjLENBQUMsRUFBQyxTQUFTLEVBQUUsT0FBTyxDQUFDLFNBQVMsRUFBRSxLQUFLLEVBQUUsT0FBTyxDQUFDLEtBQUssRUFBQyxDQUFDLENBQUE7Z0JBQzNFLENBQUM7Z0JBQ0QsSUFBSSxDQUFDLHdCQUF3QixDQUFDO29CQUM1QixLQUFLLEVBQUUsT0FBTyxDQUFDLEtBQUs7b0JBQ3BCLFNBQVMsRUFBRSxPQUFPLENBQUMsU0FBUztvQkFDNUIsYUFBYSxFQUFFLE9BQU8sQ0FBQyxhQUFhO29CQUNwQyxHQUFHLEVBQUUsU0FBUztvQkFDZCxhQUFhLEVBQUUsT0FBTyxDQUFDLGFBQWE7b0JBQ3BDLFFBQVEsRUFBRSxPQUFPLENBQUMsUUFBUTtpQkFDM0IsQ0FBQyxDQUFBO1lBQ0osQ0FBQztZQUVELElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQyxFQUFDLFFBQVEsRUFBRSxPQUFPLENBQUMsU0FBUyxDQUFDLEVBQUUsS0FBSyxFQUFFLE9BQU8sQ0FBQyxLQUFLLEVBQUUsTUFBTSxFQUFFLFFBQVEsRUFBQyxDQUFDLENBQUE7WUFDM0YsVUFBVSxDQUFDLElBQUksQ0FBQyxFQUFDLElBQUksRUFBRSxhQUFhLEVBQUUsS0FBSyxFQUFFLE9BQU8sQ0FBQyxLQUFLLEVBQUMsQ0FBQyxDQUFBO1lBQzVELGtFQUFrRTtZQUNsRSxtREFBbUQ7WUFDbkQsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFBO1lBQ3RCLE1BQU0sSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFBO1FBQ3JCLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQywrQkFBK0IsRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFBO1lBQ2pFLFVBQVUsQ0FBQyxJQUFJLENBQUMsRUFBQyxJQUFJLEVBQUUsa0JBQWtCLEVBQUUsS0FBSyxFQUFFLE9BQU8sQ0FBQyxLQUFLLEVBQUUsS0FBSyxFQUFFLHNCQUFzQixFQUFDLENBQUMsQ0FBQTtRQUNsRyxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCx3QkFBd0IsQ0FBQyxFQUFDLEtBQUssRUFBRSxTQUFTLEVBQUUsYUFBYSxFQUFFLEdBQUcsRUFBRSxhQUFhLEVBQUUsUUFBUSxFQUFDO1FBQ3RGLE1BQU0sZUFBZSxHQUFHLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUMxRCxNQUFNLE9BQU8sR0FBRztZQUNkLE9BQU8sRUFBRTtnQkFDUCxRQUFRLEVBQUUsR0FBRyxDQUFDLFFBQVE7Z0JBQ3RCLFNBQVM7Z0JBQ1QsYUFBYTtnQkFDYixPQUFPLEVBQUUsR0FBRyxDQUFDLElBQUk7Z0JBQ2pCLEtBQUssRUFBRSxHQUFHLENBQUMsRUFBRTtnQkFDYixPQUFPLEVBQUUsR0FBRyxDQUFDLE9BQU87Z0JBQ3BCLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVTtnQkFDMUIsYUFBYTtnQkFDYixLQUFLLEVBQUUsdUJBQXVCO2dCQUM5QixNQUFNLEVBQUUsR0FBRyxDQUFDLE1BQU07Z0JBQ2xCLFFBQVEsRUFBRSxHQUFHLENBQUMsTUFBTSxLQUFLLFFBQVEsSUFBSSxHQUFHLENBQUMsTUFBTSxLQUFLLFVBQVU7Z0JBQzlELFNBQVMsRUFBRSxHQUFHLENBQUMsTUFBTSxLQUFLLFFBQVE7Z0JBQ2xDLFFBQVE7YUFDVDtZQUNELEtBQUssRUFBRSxlQUFlO1NBQ3ZCLENBQUE7UUFDRCxNQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLGNBQWMsRUFBRSxDQUFBO1FBRXZELFdBQVcsQ0FBQyxJQUFJLENBQUMsdUJBQXVCLEVBQUUsT0FBTyxDQUFDLENBQUE7UUFDbEQsV0FBVyxDQUFDLElBQUksQ0FBQyxXQUFXLEVBQUUsRUFBQyxHQUFHLE9BQU8sRUFBRSxTQUFTLEVBQUUsdUJBQXVCLEVBQUMsQ0FBQyxDQUFBO0lBQ2pGLENBQUM7SUFFRDs7Ozs7Ozs7T0FRRztJQUNILDBCQUEwQixDQUFDLEVBQUMsR0FBRyxFQUFDO1FBQzlCLE1BQU0sZUFBZSxHQUFHLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxHQUFHLENBQUMsU0FBUyxJQUFJLDRCQUE0QixDQUFDLENBQUE7UUFDbEcsTUFBTSxPQUFPLEdBQUc7WUFDZCxPQUFPLEVBQUU7Z0JBQ1AsUUFBUSxFQUFFLEdBQUcsQ0FBQyxRQUFRO2dCQUN0QixPQUFPLEVBQUUsR0FBRyxDQUFDLElBQUk7Z0JBQ2pCLEtBQUssRUFBRSxHQUFHLENBQUMsRUFBRTtnQkFDYixPQUFPLEVBQUUsR0FBRyxDQUFDLE9BQU87Z0JBQ3BCLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVTtnQkFDMUIsS0FBSyxFQUFFLHlCQUF5QjtnQkFDaEMsTUFBTSxFQUFFLEdBQUcsQ0FBQyxNQUFNO2dCQUNsQixRQUFRLEVBQUUsR0FBRyxDQUFDLE1BQU0sS0FBSyxRQUFRLElBQUksR0FBRyxDQUFDLE1BQU0sS0FBSyxVQUFVO2dCQUM5RCxTQUFTLEVBQUUsR0FBRyxDQUFDLE1BQU0sS0FBSyxRQUFRO2FBQ25DO1lBQ0QsS0FBSyxFQUFFLGVBQWU7U0FDdkIsQ0FBQTtRQUNELE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsY0FBYyxFQUFFLENBQUE7UUFFdkQsV0FBVyxDQUFDLElBQUksQ0FBQyx5QkFBeUIsRUFBRSxPQUFPLENBQUMsQ0FBQTtRQUNwRCxXQUFXLENBQUMsSUFBSSxDQUFDLFdBQVcsRUFBRSxFQUFDLEdBQUcsT0FBTyxFQUFFLFNBQVMsRUFBRSx5QkFBeUIsRUFBQyxDQUFDLENBQUE7SUFDbkYsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxzQkFBc0IsQ0FBQyxLQUFLO1FBQzFCLElBQUksS0FBSyxZQUFZLEtBQUs7WUFBRSxPQUFPLEtBQUssQ0FBQTtRQUV4QyxPQUFPLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxLQUFLLENBQUMsQ0FBQTtJQUM3QyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILHdCQUF3QixDQUFDLEtBQUs7UUFDNUIsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLDBCQUEwQixDQUFDLEtBQUssQ0FBQyxDQUFBO1FBQ3RELE1BQU0sZUFBZSxHQUFHLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBRTFDLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxFQUFDLEtBQUssRUFBRSxlQUFlLEVBQUMsQ0FBQyxDQUFBO1FBRXRELE9BQU8sZUFBZSxDQUFBO0lBQ3hCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsMEJBQTBCLENBQUMsS0FBSztRQUM5QixJQUFJLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxLQUFLLENBQUM7WUFBRSxPQUFPLEtBQUssQ0FBQyxJQUFJLEVBQUUsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFFckUsT0FBTyxNQUFNLENBQUMsS0FBSyxJQUFJLHVCQUF1QixDQUFDLENBQUE7SUFDakQsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxpQkFBaUIsQ0FBQyxLQUFLO1FBQ3JCLE9BQU8sT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLEtBQUssQ0FBQyxJQUFJLEVBQUUsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFBO0lBQzdELENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCx1QkFBdUIsQ0FBQyxFQUFDLEtBQUssRUFBRSxlQUFlLEVBQUM7UUFDOUMsSUFBSSxJQUFJLENBQUMsaUJBQWlCLENBQUMsS0FBSyxDQUFDO1lBQUUsZUFBZSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUE7SUFDbEUsQ0FBQztJQUVEOzs7Ozs7Ozs7Ozs7Ozs7O09BZ0JHO0lBQ0gsS0FBSyxDQUFDLE1BQU07UUFDVixJQUFJLElBQUksQ0FBQyxRQUFRLElBQUksSUFBSSxDQUFDLGNBQWMsS0FBSyxRQUFRLElBQUksQ0FBQyxJQUFJLENBQUMscUJBQXFCO1lBQUUsT0FBTTtRQUU1RixJQUFJLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztZQUN2QixJQUFJLENBQUMsY0FBYyxHQUFHLElBQUksQ0FBQTtZQUMxQixNQUFNLElBQUksQ0FBQyxhQUFhLENBQUE7WUFDeEIsT0FBTTtRQUNSLENBQUM7UUFFRCxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsa0JBQWtCLEVBQUUsQ0FBQTtRQUU5QyxJQUFJLENBQUMsYUFBYSxHQUFHLFlBQVksQ0FBQTtRQUNqQyxNQUFNLFlBQVksQ0FBQTtJQUNwQixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLGtCQUFrQjtRQUN0QixJQUFJLENBQUMsU0FBUyxHQUFHLElBQUksQ0FBQTtRQUVyQixJQUFJLENBQUM7WUFDSCxJQUFJLE9BQU8sQ0FBQTtZQUVYLEdBQUcsQ0FBQztnQkFDRixPQUFPLEdBQUcsTUFBTSxJQUFJLENBQUMsZUFBZSxFQUFFLENBQUE7Z0JBQ3RDLE1BQU0sSUFBSSxDQUFDLFlBQVksQ0FBQyxFQUFDLE9BQU8sRUFBQyxDQUFDLENBQUE7WUFDcEMsQ0FBQyxRQUFRLENBQUMsT0FBTyxJQUFJLElBQUksQ0FBQyxjQUFjLElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxJQUFJLElBQUksQ0FBQyxjQUFjLEtBQUssUUFBUSxFQUFDO1FBQ2pHLENBQUM7Z0JBQVMsQ0FBQztZQUNULElBQUksQ0FBQyxTQUFTLEdBQUcsS0FBSyxDQUFBO1lBQ3RCLElBQUksQ0FBQyxhQUFhLEdBQUcsU0FBUyxDQUFBO1FBQ2hDLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsWUFBWSxDQUFDLEVBQUMsT0FBTyxFQUFDO1FBQzFCLElBQUksSUFBSSxDQUFDLFFBQVEsSUFBSSxJQUFJLENBQUMsY0FBYyxLQUFLLFFBQVE7WUFBRSxPQUFNO1FBQzdELElBQUksT0FBTztZQUFFLE9BQU8sSUFBSSxDQUFDLG1CQUFtQixFQUFFLENBQUE7UUFFOUMsTUFBTSxJQUFJLENBQUMseUJBQXlCLEVBQUUsQ0FBQTtJQUN4QyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLHlCQUF5QjtRQUM3QixJQUFJLENBQUM7WUFDSCxNQUFNLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxDQUFBO1FBQ2pDLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxnREFBZ0QsRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFBO1lBQ2xGLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxDQUFBO1lBQzFCLE9BQU07UUFDUixDQUFDO1FBRUQsSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUE7SUFDOUIsQ0FBQztJQUVEOzt5QkFFcUI7SUFDckIscUJBQXFCO1FBQ25CLElBQUksSUFBSSxDQUFDLHdCQUF3QixDQUFDLElBQUksR0FBRyxDQUFDO1lBQUUsT0FBTTtRQUNsRCxJQUFJLElBQUksQ0FBQywyQkFBMkIsSUFBSSxJQUFJLENBQUMsc0JBQXNCLENBQUMsTUFBTSxHQUFHLENBQUM7WUFBRSxPQUFNO1FBRXRGLEtBQUssTUFBTSxNQUFNLElBQUksSUFBSSxDQUFDLGNBQWMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDO1lBQ2hELElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUM7Z0JBQUUsT0FBTTtRQUN2QyxDQUFDO1FBRUQsSUFBSSxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQztZQUMxQixZQUFZLENBQUMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLENBQUE7WUFDbkMsSUFBSSxDQUFDLGdCQUFnQixHQUFHLFNBQVMsQ0FBQTtRQUNuQyxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxlQUFlO1FBQ25CLE9BQU8sTUFBTSxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUE7SUFDbkMsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxhQUFhO1FBQ2pCLEdBQUcsQ0FBQztZQUNGLElBQUksQ0FBQyxjQUFjLEdBQUcsS0FBSyxDQUFBO1lBQzNCLE1BQU0sT0FBTyxHQUFHLE1BQU0sSUFBSSxDQUFDLHlCQUF5QixFQUFFLENBQUE7WUFFdEQsSUFBSSxPQUFPO2dCQUFFLE9BQU8sSUFBSSxDQUFBO1FBQzFCLENBQUMsUUFBUSxJQUFJLENBQUMsY0FBYyxJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBQztRQUUvQyxPQUFPLEtBQUssQ0FBQTtJQUNkLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMseUJBQXlCO1FBQzdCLElBQUksQ0FBQztZQUNILE1BQU0sSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFBO1lBQ3ZCLE9BQU8sS0FBSyxDQUFBO1FBQ2QsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLCtCQUErQixFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUE7WUFDakUsSUFBSSxLQUFLLFlBQVksWUFBWTtnQkFBRSxJQUFJLENBQUMsc0JBQXNCLENBQUMsS0FBSyxDQUFDLENBQUE7WUFDckUsT0FBTyxJQUFJLENBQUE7UUFDYixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7OztPQVFHO0lBQ0gsS0FBSyxDQUFDLDJCQUEyQixDQUFDLFNBQVMsRUFBRSxRQUFRO1FBQ25ELE9BQU8sTUFBTSxPQUFPLENBQUM7WUFDbkIsWUFBWSxFQUFFLHlEQUF5RCxJQUFJLENBQUMsNEJBQTRCLE9BQU8sU0FBUyxFQUFFO1lBQzFILE9BQU8sRUFBRSxJQUFJLENBQUMsNEJBQTRCO1NBQzNDLEVBQUUsUUFBUSxDQUFDLENBQUE7SUFDZCxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsc0JBQXNCLENBQUMsS0FBSztRQUMxQixNQUFNLE9BQU8sR0FBRztZQUNkLE9BQU8sRUFBRTtnQkFDUCxLQUFLLEVBQUUsNkJBQTZCO2dCQUNwQyw0QkFBNEIsRUFBRSxJQUFJLENBQUMsNEJBQTRCO2dCQUMvRCxnQkFBZ0IsRUFBRSxJQUFJLENBQUMsZ0JBQWdCO2FBQ3hDO1lBQ0QsS0FBSztTQUNOLENBQUE7UUFDRCxNQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLGNBQWMsRUFBRSxDQUFBO1FBRXZELFdBQVcsQ0FBQyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsT0FBTyxDQUFDLENBQUE7UUFDNUMsV0FBVyxDQUFDLElBQUksQ0FBQyxXQUFXLEVBQUUsRUFBQyxHQUFHLE9BQU8sRUFBRSxTQUFTLEVBQUUsaUJBQWlCLEVBQUMsQ0FBQyxDQUFBO0lBQzNFLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxtQkFBbUI7UUFDakIsSUFBSSxJQUFJLENBQUMsUUFBUTtZQUFFLE9BQU07UUFDekIsSUFBSSxJQUFJLENBQUMsZ0JBQWdCO1lBQUUsT0FBTTtRQUNqQyxJQUFJLElBQUksQ0FBQyxnQkFBZ0IsS0FBSyxTQUFTLElBQUksSUFBSSxDQUFDLGNBQWMsS0FBSyxRQUFRO1lBQUUsT0FBTTtRQUVuRixJQUFJLENBQUMsZ0JBQWdCLEdBQUcsVUFBVSxDQUFDLEdBQUcsRUFBRTtZQUN0QyxJQUFJLENBQUMsZ0JBQWdCLEdBQUcsU0FBUyxDQUFBO1lBQ2pDLEtBQUssSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUE7UUFDOUIsQ0FBQyxFQUFFLElBQUksQ0FBQyxjQUFjLENBQUMsQ0FBQTtJQUN6QixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxnQkFBZ0I7UUFDcEIsSUFBSSxJQUFJLENBQUMsUUFBUTtZQUFFLE9BQU07UUFFekIsSUFBSSxJQUFJLENBQUMsMkJBQTJCLElBQUksSUFBSSxDQUFDLHNCQUFzQixDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUMvRSxNQUFNLElBQUksQ0FBQywyQkFBMkIsRUFBRSxDQUFBO1lBQ3hDLElBQUksSUFBSSxDQUFDLHNCQUFzQixDQUFDLE1BQU0sR0FBRyxDQUFDO2dCQUFFLE9BQU07UUFDcEQsQ0FBQztRQUVELElBQUksQ0FBQztZQUNILE1BQU0sSUFBSSxDQUFDLDhCQUE4QixFQUFFLENBQUE7UUFDN0MsQ0FBQztRQUFDLE1BQU0sQ0FBQztZQUNQLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxDQUFBO1lBQzFCLE9BQU07UUFDUixDQUFDO1FBRUQsSUFBSSxDQUFDO1lBQ0gsS0FBSyxNQUFNLE1BQU0sSUFBSSxJQUFJLENBQUMsY0FBYyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUM7Z0JBQ2hELElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUM7b0JBQUUsTUFBTSxJQUFJLENBQUMsc0JBQXNCLENBQUMsTUFBTSxDQUFDLENBQUE7WUFDMUUsQ0FBQztRQUNILENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsSUFBSSxDQUFDLDBCQUEwQixDQUFDLEtBQUssQ0FBQyxDQUFBO1lBQ3RDLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxDQUFBO1lBQzFCLE9BQU07UUFDUixDQUFDO1FBRUQsSUFBSSxJQUFJLENBQUMsY0FBYyxLQUFLLFFBQVE7WUFBRSxNQUFNLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQTtRQUN6RCxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtJQUMxQixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxVQUFVO1FBQ2QsT0FBTyxJQUFJLENBQUMsWUFBWSxDQUFDLElBQUksR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxJQUFJLElBQUksQ0FBQyxjQUFjLEtBQUssUUFBUSxJQUFJLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDO1lBQ3RILE1BQU0sR0FBRyxHQUFHLE1BQU0sSUFBSSxDQUFDLDJCQUEyQixDQUFDLG9CQUFvQixFQUFFLEtBQUssSUFBSSxFQUFFLENBQUMsTUFBTSxJQUFJLENBQUMsK0JBQStCLEVBQUUsQ0FBQyxDQUFBO1lBQ2xJLElBQUksQ0FBQyxHQUFHO2dCQUFFLE9BQU07WUFFaEIsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLGlCQUFpQixDQUFDLEdBQUcsQ0FBQyxDQUFBO1lBQzFDLElBQUksQ0FBQyxNQUFNO2dCQUFFLE9BQU07WUFFbkIsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLHVCQUF1QixDQUFDLEVBQUMsR0FBRyxFQUFFLE1BQU0sRUFBQyxDQUFDLENBQUE7WUFDN0QsTUFBTSxrQkFBa0IsR0FBRyxVQUFVLEVBQUUsQ0FBQTtZQUN2QyxJQUFJLE9BQU8sQ0FBQTtZQUVYLElBQUksQ0FBQztnQkFDSCxPQUFPLEdBQUcsTUFBTSxJQUFJLENBQUMsMkJBQTJCLENBQUMsaUJBQWlCLEVBQUUsS0FBSyxJQUFJLEVBQUUsQ0FBQyxNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsYUFBYSxDQUFDLEVBQUMsU0FBUyxFQUFFLGtCQUFrQixFQUFFLEtBQUssRUFBRSxHQUFHLENBQUMsRUFBRSxFQUFFLFFBQVEsRUFBRSxNQUFNLENBQUMsUUFBUSxFQUFDLENBQUMsQ0FBQyxDQUFBO1lBQzVMLENBQUM7WUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO2dCQUNmLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxFQUFDLFNBQVMsRUFBRSxrQkFBa0IsRUFBRSxLQUFLLEVBQUUsR0FBRyxDQUFDLEVBQUUsRUFBQyxDQUFDLENBQUE7Z0JBQzdFLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxFQUFDLEdBQUcsU0FBUyxFQUFFLE1BQU0sRUFBQyxDQUFDLENBQUE7Z0JBRXBELElBQUksQ0FBQztvQkFDSCxNQUFNLElBQUksQ0FBQywyQkFBMkIsQ0FBQyxpQkFBaUIsRUFBRSxLQUFLLElBQUksRUFBRSxDQUFDLE1BQU0sSUFBSSxDQUFDLGVBQWUsQ0FBQyxFQUFDLFNBQVMsRUFBRSxrQkFBa0IsRUFBRSxLQUFLLEVBQUUsR0FBRyxDQUFDLEVBQUUsRUFBQyxDQUFDLENBQUMsQ0FBQTtnQkFDbkosQ0FBQztnQkFBQyxPQUFPLGFBQWEsRUFBRSxDQUFDO29CQUN2QixJQUFJLENBQUMsMkJBQTJCLENBQUMsRUFBQyxLQUFLLEVBQUUsYUFBYSxFQUFFLFNBQVMsRUFBRSxrQkFBa0IsRUFBRSxLQUFLLEVBQUUsR0FBRyxDQUFDLEVBQUUsRUFBQyxDQUFDLENBQUE7Z0JBQ3hHLENBQUM7Z0JBRUQsTUFBTSxLQUFLLENBQUE7WUFDYixDQUFDO1lBRUQsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO2dCQUNiLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxFQUFDLEdBQUcsU0FBUyxFQUFFLE1BQU0sRUFBQyxDQUFDLENBQUE7Z0JBQ3BELFNBQVE7WUFDVixDQUFDO1lBRUQsTUFBTSxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQyxFQUFDLE9BQU8sRUFBRSxHQUFHLEVBQUMsQ0FBQyxDQUFBO1lBRTlDLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxjQUFjLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFBO1lBRWhELElBQUksQ0FBQyxRQUFRLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsSUFBSSxNQUFNLENBQUMsVUFBVSxJQUFJLElBQUksQ0FBQyxjQUFjLEtBQUssUUFBUSxJQUFJLENBQUMsSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUM7Z0JBQ25JLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxFQUFDLFNBQVMsRUFBRSxPQUFPLENBQUMsU0FBUyxFQUFFLEtBQUssRUFBRSxHQUFHLENBQUMsRUFBRSxFQUFDLENBQUMsQ0FBQTtnQkFDNUUsSUFBSSxDQUFDO29CQUNILE1BQU0sSUFBSSxDQUFDLDJCQUEyQixDQUFDLGlCQUFpQixFQUFFLEtBQUssSUFBSSxFQUFFLENBQUMsTUFBTSxJQUFJLENBQUMsZUFBZSxDQUFDLEVBQUMsU0FBUyxFQUFFLE9BQU8sQ0FBQyxTQUFTLEVBQUUsS0FBSyxFQUFFLEdBQUcsQ0FBQyxFQUFFLEVBQUMsQ0FBQyxDQUFDLENBQUE7Z0JBQ2xKLENBQUM7Z0JBQUMsT0FBTyxhQUFhLEVBQUUsQ0FBQztvQkFDdkIsSUFBSSxDQUFDLDJCQUEyQixDQUFDLEVBQUMsS0FBSyxFQUFFLGFBQWEsRUFBRSxTQUFTLEVBQUUsT0FBTyxDQUFDLFNBQVMsRUFBRSxLQUFLLEVBQUUsR0FBRyxDQUFDLEVBQUUsRUFBQyxDQUFDLENBQUE7b0JBQ3JHLE1BQU0sYUFBYSxDQUFBO2dCQUNyQixDQUFDO2dCQUNELElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQTtnQkFDdEIsSUFBSSxDQUFDLGNBQWMsR0FBRyxJQUFJLENBQUE7Z0JBQzFCLFNBQVE7WUFDVixDQUFDO1lBRUQsSUFBSSxDQUFDLHdCQUF3QixDQUFDLEVBQUMsR0FBRyxTQUFTLEVBQUUsR0FBRyxFQUFFLE1BQU0sRUFBQyxDQUFDLENBQUE7WUFDMUQsUUFBUSxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsRUFBRSxFQUFFLE9BQU8sQ0FBQyxTQUFTLENBQUMsQ0FBQTtZQUV2QyxJQUFJLENBQUM7Z0JBQ0gsTUFBTSxhQUFhLEdBQUcsT0FBTyxDQUFDLEdBQUcsSUFBSSxHQUFHLENBQUE7Z0JBRXhDLE1BQU0sQ0FBQyxJQUFJLENBQUM7b0JBQ1YsSUFBSSxFQUFFLEtBQUs7b0JBQ1gsT0FBTyxFQUFFO3dCQUNQLEVBQUUsRUFBRSxhQUFhLENBQUMsRUFBRTt3QkFDcEIsT0FBTyxFQUFFLGFBQWEsQ0FBQyxPQUFPO3dCQUM5QixJQUFJLEVBQUUsYUFBYSxDQUFDLElBQUk7d0JBQ3hCLFNBQVMsRUFBRSxPQUFPLENBQUMsU0FBUzt3QkFDNUIsUUFBUSxFQUFFLE1BQU0sQ0FBQyxRQUFRO3dCQUN6QixhQUFhLEVBQUUsT0FBTyxDQUFDLGFBQWE7d0JBQ3BDLE9BQU8sRUFBRTs0QkFDUCxjQUFjLEVBQUUsYUFBYSxDQUFDLGNBQWMsSUFBSSxTQUFTOzRCQUN6RCxhQUFhLEVBQUUsYUFBYSxDQUFDLGFBQWE7NEJBQzFDLGNBQWMsRUFBRSxhQUFhLENBQUMsY0FBYyxJQUFJLFNBQVM7NEJBQ3pELFVBQVUsRUFBRSxhQUFhLENBQUMsVUFBVSxJQUFJLFNBQVM7NEJBQ2pELEtBQUssRUFBRSxhQUFhLENBQUMsS0FBSzs0QkFDMUIsYUFBYSxFQUFFLGFBQWEsQ0FBQyxhQUFhLElBQUksU0FBUzs0QkFDdkQsR0FBRyxDQUFDLGFBQWEsQ0FBQyxTQUFTLEtBQUssSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUMsU0FBUyxFQUFFLGFBQWEsQ0FBQyxTQUFTLEVBQUMsQ0FBQzt5QkFDbEY7cUJBQ0Y7aUJBQ0YsQ0FBQyxDQUFBO1lBQ0osQ0FBQztZQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7Z0JBQ2YsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyw0Q0FBNEMsRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFBO2dCQUM3RSxJQUFJLENBQUM7b0JBQ0gsTUFBTSxDQUFDLEtBQUssRUFBRSxDQUFBO2dCQUNoQixDQUFDO2dCQUFDLE9BQU8sVUFBVSxFQUFFLENBQUM7b0JBQ3BCLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsZ0RBQWdELEVBQUUsVUFBVSxDQUFDLENBQUMsQ0FBQTtnQkFDeEYsQ0FBQztnQkFDRCxNQUFNLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxNQUFNLEVBQUUsRUFBQyxZQUFZLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtZQUNwRSxDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCx1QkFBdUIsQ0FBQyxFQUFDLEdBQUcsRUFBRSxNQUFNLEVBQUM7UUFDbkMsSUFBSSxvQkFBb0IsR0FBRyxLQUFLLENBQUE7UUFFaEMsSUFBSSxDQUFDLFlBQVksQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUE7UUFFaEMsSUFBSSxHQUFHLENBQUMsYUFBYSxLQUFLLFFBQVEsSUFBSSxNQUFNLENBQUMseUJBQXlCLElBQUksTUFBTSxDQUFDLG9CQUFvQixHQUFHLENBQUMsRUFBRSxDQUFDO1lBQzFHLG9CQUFvQixHQUFHLElBQUksQ0FBQTtZQUMzQixNQUFNLENBQUMsb0JBQW9CLElBQUksQ0FBQyxDQUFBO1lBQ2hDLElBQUksTUFBTSxDQUFDLG9CQUFvQixHQUFHLENBQUM7Z0JBQUUsSUFBSSxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDcEUsQ0FBQztRQUVELE9BQU8sRUFBQyxvQkFBb0IsRUFBRSxnQkFBZ0IsRUFBRSxNQUFNLENBQUMsZ0JBQWdCLEVBQUMsQ0FBQTtJQUMxRSxDQUFDO0lBRUQ7Ozs7Ozs7O09BUUc7SUFDSCx1QkFBdUIsQ0FBQyxFQUFDLG9CQUFvQixFQUFFLGdCQUFnQixFQUFFLE1BQU0sRUFBQztRQUN0RSxJQUFJLElBQUksQ0FBQyxRQUFRLElBQUksSUFBSSxDQUFDLGNBQWMsS0FBSyxRQUFRLElBQUksQ0FBQyxJQUFJLENBQUMscUJBQXFCLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsSUFBSSxNQUFNLENBQUMsVUFBVTtZQUFFLE9BQU07UUFFOUksSUFBSSxvQkFBb0IsSUFBSSxNQUFNLENBQUMsZ0JBQWdCLEtBQUssZ0JBQWdCLEVBQUUsQ0FBQztZQUN6RSxNQUFNLENBQUMsb0JBQW9CLElBQUksQ0FBQyxDQUFBO1FBQ2xDLENBQUM7UUFFRCxJQUFJLE1BQU0sQ0FBQywwQkFBMEI7WUFBRSxJQUFJLENBQUMsWUFBWSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQTtJQUN0RSxDQUFDO0lBRUQ7Ozs7Ozs7OztPQVNHO0lBQ0gsd0JBQXdCLENBQUMsRUFBQyxHQUFHLEVBQUUsb0JBQW9CLEVBQUUsZ0JBQWdCLEVBQUUsTUFBTSxFQUFDO1FBQzVFLElBQUksQ0FBQyxvQkFBb0IsSUFBSSxHQUFHLENBQUMsYUFBYSxLQUFLLFFBQVE7WUFBRSxPQUFNO1FBQ25FLElBQUksTUFBTSxDQUFDLGdCQUFnQixLQUFLLGdCQUFnQixJQUFJLENBQUMsTUFBTSxDQUFDLHlCQUF5QjtZQUFFLE9BQU07UUFDN0YsSUFBSSxNQUFNLENBQUMsb0JBQW9CLElBQUksQ0FBQztZQUFFLE9BQU07UUFFNUMsTUFBTSxDQUFDLG9CQUFvQixJQUFJLENBQUMsQ0FBQTtRQUNoQyxJQUFJLE1BQU0sQ0FBQyxvQkFBb0IsS0FBSyxDQUFDO1lBQUUsSUFBSSxDQUFDLFlBQVksQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUE7SUFDekUsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCx3QkFBd0IsQ0FBQyxFQUFDLFNBQVMsRUFBRSxLQUFLLEVBQUM7UUFDekMsSUFBSSxDQUFDLHdCQUF3QixDQUFDLEdBQUcsQ0FBQyxTQUFTLEVBQUUsS0FBSyxDQUFDLENBQUE7SUFDckQsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsS0FBSyxDQUFDLGVBQWUsQ0FBQyxFQUFDLFNBQVMsRUFBRSxLQUFLLEVBQUM7UUFDdEMsTUFBTSxJQUFJLENBQUMsS0FBSyxDQUFDLG1CQUFtQixDQUFDLEVBQUMsU0FBUyxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7UUFFeEQsSUFBSSxJQUFJLENBQUMsd0JBQXdCLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxLQUFLLEtBQUssRUFBRSxDQUFDO1lBQzNELElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLENBQUE7UUFDakQsQ0FBQztJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLDhCQUE4QjtRQUNsQyxLQUFLLE1BQU0sQ0FBQyxTQUFTLEVBQUUsS0FBSyxDQUFDLElBQUksQ0FBQyxHQUFHLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxFQUFFLENBQUM7WUFDcEUsSUFBSSxDQUFDO2dCQUNILE1BQU0sSUFBSSxDQUFDLGVBQWUsQ0FBQyxFQUFDLFNBQVMsRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1lBQ2hELENBQUM7WUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO2dCQUNmLElBQUksQ0FBQywyQkFBMkIsQ0FBQyxFQUFDLEtBQUssRUFBRSxTQUFTLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtnQkFDM0QsTUFBTSxLQUFLLENBQUE7WUFDYixDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsMkJBQTJCLENBQUMsRUFBQyxLQUFLLEVBQUUsU0FBUyxFQUFFLEtBQUssRUFBQztRQUNuRCxNQUFNLGVBQWUsR0FBRyxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLElBQUksS0FBSyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFBO1FBQ2pGLE1BQU0sT0FBTyxHQUFHO1lBQ2QsT0FBTyxFQUFFLEVBQUMsU0FBUyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsMkNBQTJDLEVBQUM7WUFDL0UsS0FBSyxFQUFFLGVBQWU7U0FDdkIsQ0FBQTtRQUNELE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsY0FBYyxFQUFFLENBQUE7UUFFdkQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyx3REFBd0QsRUFBRSxlQUFlLENBQUMsQ0FBQyxDQUFBO1FBQ3BHLFdBQVcsQ0FBQyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsT0FBTyxDQUFDLENBQUE7UUFDNUMsV0FBVyxDQUFDLElBQUksQ0FBQyxXQUFXLEVBQUUsRUFBQyxHQUFHLE9BQU8sRUFBRSxTQUFTLEVBQUUsaUJBQWlCLEVBQUMsQ0FBQyxDQUFBO0lBQzNFLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsK0JBQStCO1FBQ25DLE1BQU0sY0FBYyxHQUFHLElBQUksQ0FBQyx5QkFBeUIsRUFBRSxDQUFBO1FBRXZELElBQUksY0FBYyxDQUFDLE1BQU0sS0FBSyxDQUFDO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFDNUMsSUFBSSxjQUFjLENBQUMsTUFBTSxLQUFLLGtDQUFrQyxDQUFDLE1BQU07WUFBRSxPQUFPLE1BQU0sSUFBSSxDQUFDLEtBQUssQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1FBRW5ILE9BQU8sTUFBTSxJQUFJLENBQUMsS0FBSyxDQUFDLGdCQUFnQixDQUFDLEVBQUMsYUFBYSxFQUFFLGNBQWMsRUFBQyxDQUFDLENBQUE7SUFDM0UsQ0FBQztJQUVEOzs7T0FHRztJQUNILHlCQUF5QjtRQUN2QixNQUFNLGNBQWMsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1FBRWhDLEtBQUssTUFBTSxNQUFNLElBQUksSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFDO1lBQ3ZDLElBQUksQ0FBQywwQkFBMEIsQ0FBQyxFQUFDLGNBQWMsRUFBRSxNQUFNLEVBQUMsQ0FBQyxDQUFBO1FBQzNELENBQUM7UUFFRCxPQUFPLGdFQUFnRSxDQUFDLENBQUMsQ0FBQyxHQUFHLGNBQWMsQ0FBQyxDQUFDLENBQUE7SUFDL0YsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILDBCQUEwQixDQUFDLEVBQUMsY0FBYyxFQUFFLE1BQU0sRUFBQztRQUNqRCxJQUFJLENBQUMsTUFBTSxDQUFDLDBCQUEwQjtZQUFFLE9BQU07UUFFOUMsS0FBSyxNQUFNLFVBQVUsSUFBSSxrQ0FBa0MsRUFBRSxDQUFDO1lBQzVELElBQUksVUFBVSxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUM7Z0JBQUUsY0FBYyxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsYUFBYSxDQUFDLENBQUE7UUFDOUUsQ0FBQztJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsaUJBQWlCLENBQUMsR0FBRztRQUNuQixLQUFLLE1BQU0sTUFBTSxJQUFJLElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQztZQUN2QyxJQUFJLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxFQUFDLEdBQUcsRUFBRSxNQUFNLEVBQUMsQ0FBQztnQkFBRSxPQUFPLE1BQU0sQ0FBQTtRQUMxRCxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILGlCQUFpQixDQUFDLEVBQUMsR0FBRyxFQUFFLE1BQU0sRUFBQztRQUM3QixJQUFJLENBQUMsTUFBTSxDQUFDLDBCQUEwQjtZQUFFLE9BQU8sS0FBSyxDQUFBO1FBRXBELE1BQU0sVUFBVSxHQUFHLDBDQUEwQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLENBQUE7UUFFcEYsSUFBSSxDQUFDLFVBQVU7WUFBRSxPQUFPLEtBQUssQ0FBQTtRQUU3QixPQUFPLFVBQVUsQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUE7SUFDbkMsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyxrQkFBa0I7UUFDdEIsSUFBSSxJQUFJLENBQUMsZUFBZSxFQUFFLENBQUM7WUFDekIsSUFBSSxDQUFDLEtBQUssQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxDQUFBO1lBQzdDLElBQUksQ0FBQyxlQUFlLEdBQUcsU0FBUyxDQUFBO1FBQ2xDLENBQUM7UUFFRCxJQUFJLElBQUksQ0FBQyxRQUFRLElBQUksSUFBSSxDQUFDLGNBQWMsS0FBSyxRQUFRLElBQUksQ0FBQyxJQUFJLENBQUMscUJBQXFCO1lBQUUsT0FBTTtRQUM1RixJQUFJLElBQUksQ0FBQyxnQkFBZ0IsS0FBSyxTQUFTO1lBQUUsT0FBTTtRQUUvQyxNQUFNLElBQUksR0FBRyxNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQTtRQUNoRCxJQUFJLEtBQUssQ0FBQTtRQUVULElBQUksSUFBSSxJQUFJLE9BQU8sSUFBSSxDQUFDLGFBQWEsS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUNuRCxLQUFLLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsYUFBYSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLEVBQUUsWUFBWSxDQUFDLENBQUMsQ0FBQTtRQUNwRixDQUFDO1FBRUQsb0VBQW9FO1FBQ3BFLDJFQUEyRTtRQUMzRSxrRUFBa0U7UUFDbEUsd0VBQXdFO1FBQ3hFLDBCQUEwQjtRQUMxQixJQUFJLE1BQU0sSUFBSSxDQUFDLCtCQUErQixFQUFFO1lBQUUsS0FBSyxHQUFHLENBQUMsQ0FBQTtRQUUzRCxJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVE7WUFBRSxPQUFNO1FBRXJDLElBQUksQ0FBQyxlQUFlLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsR0FBRyxFQUFFO1lBQ2hELElBQUksQ0FBQyxlQUFlLEdBQUcsU0FBUyxDQUFBO1lBQ2hDLEtBQUssSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFBO1FBQ3BCLENBQUMsRUFBRSxLQUFLLENBQUMsQ0FBQTtJQUNYLENBQUM7SUFFRCxLQUFLLENBQUMsYUFBYTtRQUNqQixJQUFJLENBQUM7WUFDSCxJQUFJLFlBQVksQ0FBQTtZQUVoQixJQUFJLElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQztnQkFDdEIsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO2dCQUNwQyxLQUFLLE1BQU0sTUFBTSxJQUFJLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztvQkFDbEMsSUFBSSxNQUFNLENBQUMsUUFBUTt3QkFBRSxrQkFBa0IsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFBO2dCQUM5RCxDQUFDO2dCQUNELEtBQUssTUFBTSxRQUFRLElBQUksSUFBSSxDQUFDLG1CQUFtQixDQUFDLElBQUksRUFBRTtvQkFBRSxrQkFBa0IsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLENBQUE7Z0JBRXhGLE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLEdBQUcsNEJBQTRCLENBQUE7Z0JBQzlELE1BQU0sUUFBUSxHQUFHLENBQUMsTUFBTSxJQUFJLENBQUMsK0JBQStCLEVBQUUsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLE9BQU8sRUFBRSxFQUFFO29CQUNqRixPQUFPLE9BQU8sQ0FBQyxhQUFhLElBQUksTUFBTSxJQUFJLENBQUMsa0JBQWtCLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsQ0FBQTtnQkFDckYsQ0FBQyxDQUFDLENBQUE7Z0JBQ0YsWUFBWSxHQUFHLFFBQVEsQ0FBQyxNQUFNLEtBQUssQ0FBQztvQkFDbEMsQ0FBQyxDQUFDLEVBQUU7b0JBQ0osQ0FBQyxDQUFDLE1BQU0sSUFBSSxDQUFDLEtBQUssQ0FBQyxvQkFBb0IsQ0FBQyxFQUFDLFFBQVEsRUFBRSxLQUFLLEVBQUUscURBQXFELEVBQUMsQ0FBQyxDQUFBO1lBQ3JILENBQUM7aUJBQU0sQ0FBQztnQkFDTixZQUFZLEdBQUcsTUFBTSxJQUFJLENBQUMsS0FBSyxDQUFDLGdCQUFnQixFQUFFLENBQUE7WUFDcEQsQ0FBQztZQUVELE1BQU0sSUFBSSxDQUFDLG1CQUFtQixDQUFDLEVBQUMsSUFBSSxFQUFFLFlBQVksRUFBRSxPQUFPLEVBQUUsaUNBQWlDLEVBQUMsQ0FBQyxDQUFBO1FBQ2xHLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsTUFBTSxlQUFlLEdBQUcsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQTtZQUNqRixNQUFNLE9BQU8sR0FBRyxFQUFDLE9BQU8sRUFBRSxFQUFDLFlBQVksRUFBRSxJQUFJLENBQUMsWUFBWSxFQUFFLEtBQUssRUFBRSw2QkFBNkIsRUFBQyxFQUFFLEtBQUssRUFBRSxlQUFlLEVBQUMsQ0FBQTtZQUMxSCxNQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLGNBQWMsRUFBRSxDQUFBO1lBRXZELElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsK0JBQStCLEVBQUUsZUFBZSxDQUFDLENBQUMsQ0FBQTtZQUMzRSxXQUFXLENBQUMsSUFBSSxDQUFDLGlCQUFpQixFQUFFLE9BQU8sQ0FBQyxDQUFBO1lBQzVDLFdBQVcsQ0FBQyxJQUFJLENBQUMsV0FBVyxFQUFFLEVBQUMsR0FBRyxPQUFPLEVBQUUsU0FBUyxFQUFFLGlCQUFpQixFQUFDLENBQUMsQ0FBQTtRQUMzRSxDQUFDO1FBRUQsSUFBSSxJQUFJLENBQUMsY0FBYyxLQUFLLFFBQVE7WUFBRSxNQUFNLElBQUksQ0FBQywyQkFBMkIsRUFBRSxDQUFBO0lBQ2hGLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLDJCQUEyQjtRQUMvQixJQUFJLENBQUM7WUFDSCxNQUFNLE1BQU0sR0FBRyxNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsMEJBQTBCLEVBQUUsQ0FBQTtZQUU1RCxJQUFJLE1BQU0sQ0FBQyxhQUFhLEdBQUcsQ0FBQztnQkFBRSxNQUFNLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQTtRQUNuRCxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLE1BQU0sZUFBZSxHQUFHLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsSUFBSSxLQUFLLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUE7WUFDakYsTUFBTSxPQUFPLEdBQUcsRUFBQyxPQUFPLEVBQUUsRUFBQyxZQUFZLEVBQUUsSUFBSSxDQUFDLFlBQVksRUFBRSxLQUFLLEVBQUUsMkNBQTJDLEVBQUMsRUFBRSxLQUFLLEVBQUUsZUFBZSxFQUFDLENBQUE7WUFDeEksTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxjQUFjLEVBQUUsQ0FBQTtZQUV2RCxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLCtEQUErRCxFQUFFLGVBQWUsQ0FBQyxDQUFDLENBQUE7WUFDM0csV0FBVyxDQUFDLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxPQUFPLENBQUMsQ0FBQTtZQUM1QyxXQUFXLENBQUMsSUFBSSxDQUFDLFdBQVcsRUFBRSxFQUFDLEdBQUcsT0FBTyxFQUFFLFNBQVMsRUFBRSxpQkFBaUIsRUFBQyxDQUFDLENBQUE7UUFDM0UsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7Ozs7T0FRRztJQUNILEtBQUssQ0FBQyxtQkFBbUIsQ0FBQyxFQUFDLElBQUksRUFBRSxPQUFPLEVBQUM7UUFDdkMsSUFBSSxJQUFJLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQ3RCLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFBO1lBQ3hCLE9BQU07UUFDUixDQUFDO1FBRUQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxPQUFPLEVBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUE7UUFDOUMsMEVBQTBFO1FBQzFFLHdFQUF3RTtRQUN4RSxJQUFJLENBQUMsZUFBZSxFQUFFLENBQUE7UUFDdEIsc0VBQXNFO1FBQ3RFLDBFQUEwRTtRQUMxRSxLQUFLLE1BQU0sR0FBRyxJQUFJLElBQUksRUFBRSxDQUFDO1lBQ3ZCLElBQUksQ0FBQztnQkFDSCxJQUFJLENBQUMsMEJBQTBCLENBQUMsRUFBQyxHQUFHLEVBQUMsQ0FBQyxDQUFBO1lBQ3hDLENBQUM7WUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO2dCQUNmLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsZ0RBQWdELEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQTtZQUNwRixDQUFDO1FBQ0gsQ0FBQztRQUNELE1BQU0sSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFBO1FBQ25CLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFBO0lBQzFCLENBQUM7SUFFRDs7Ozs7Ozs7T0FRRztJQUNILEtBQUssQ0FBQyxrQkFBa0I7UUFDdEIsSUFBSSxJQUFJLENBQUMsUUFBUTtZQUFFLE9BQU07UUFFekIsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsR0FBRyxJQUFJLENBQUMsb0JBQW9CLENBQUE7UUFDM0QsMkJBQTJCO1FBQzNCLE1BQU0sS0FBSyxHQUFHLEVBQUUsQ0FBQTtRQUVoQixLQUFLLE1BQU0sTUFBTSxJQUFJLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUNsQywyRUFBMkU7WUFDM0UsMEVBQTBFO1lBQzFFLHNFQUFzRTtZQUN0RSx1RUFBdUU7WUFDdkUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxpQkFBaUI7Z0JBQUUsU0FBUTtZQUV2QyxNQUFNLFVBQVUsR0FBRyxPQUFPLE1BQU0sQ0FBQyxVQUFVLEtBQUssUUFBUSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUE7WUFFaEYsSUFBSSxVQUFVLElBQUksTUFBTTtnQkFBRSxLQUFLLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBQzlDLENBQUM7UUFFRCxLQUFLLE1BQU0sTUFBTSxJQUFJLEtBQUssRUFBRSxDQUFDO1lBQzNCLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsdUNBQXVDLEVBQUUsRUFBQyxRQUFRLEVBQUUsTUFBTSxDQUFDLFFBQVEsRUFBRSxVQUFVLEVBQUUsTUFBTSxDQUFDLFVBQVUsRUFBQyxDQUFDLENBQUMsQ0FBQTtZQUU3SCxJQUFJLENBQUM7Z0JBQ0gsTUFBTSxDQUFDLEtBQUssRUFBRSxDQUFBO1lBQ2hCLENBQUM7WUFBQyxNQUFNLENBQUM7Z0JBQ1AsNERBQTREO1lBQzlELENBQUM7WUFFRCxNQUFNLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUM5QyxDQUFDO0lBQ0gsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB0aW1lb3V0LCB7IFRpbWVvdXRFcnJvciB9IGZyb20gXCJhd2FpdGVyeS9idWlsZC90aW1lb3V0LmpzXCJcbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tIFwiY3J5cHRvXCJcbmltcG9ydCBuZXQgZnJvbSBcIm5ldFwiXG5pbXBvcnQgSnNvblNvY2tldCBmcm9tIFwiLi9qc29uLXNvY2tldC5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYnNTY2hlZHVsZXIgZnJvbSBcIi4vc2NoZWR1bGVyLmpzXCJcbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uL2xvZ2dlci5qc1wiXG5pbXBvcnQgUHJ1bmVUZXJtaW5hbEJhY2tncm91bmRKb2JzSm9iIGZyb20gXCIuLi9qb2JzL3BydW5lLXRlcm1pbmFsLWJhY2tncm91bmQtam9icy5qc1wiXG5pbXBvcnQgVmVsb2Npb3VzRXJyb3IgZnJvbSBcIi4uL3ZlbG9jaW91cy1lcnJvci5qc1wiXG5pbXBvcnQgc2h1dGRvd25MaWZlY3ljbGUsIHsgcnVuU2h1dGRvd25TdGVwcyB9IGZyb20gXCIuLi91dGlscy9zaHV0ZG93bi1saWZlY3ljbGUuanNcIlxuaW1wb3J0IHsgdmFsaWRhdGVHZW5lcmF0aW9uSWQsIHdvcmtlcklkQmVsb25nc1RvR2VuZXJhdGlvbiB9IGZyb20gXCIuL2dlbmVyYXRpb24taWRlbnRpdHkuanNcIlxuaW1wb3J0IEJhY2tncm91bmRKb2JzTGlmZWN5Y2xlQ29udHJvbFNlcnZlciBmcm9tIFwiLi9saWZlY3ljbGUtY29udHJvbC1zZXJ2ZXIuanNcIlxuXG4vKipcbiAqIFdvcmtlckV4ZWN1dGlvbk1vZGVDYXBhYmlsaXR5IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBXb3JrZXJFeGVjdXRpb25Nb2RlQ2FwYWJpbGl0eVxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlfSBleGVjdXRpb25Nb2RlIC0gRXhlY3V0aW9uIG1vZGUuXG4gKiBAcHJvcGVydHkgeyh3b3JrZXI6IEpzb25Tb2NrZXQpID0+IGJvb2xlYW59IGFjY2VwdHMgLSBXaGV0aGVyIHRoZSB3b3JrZXIgYWNjZXB0cyB0aGlzIG1vZGUuXG4gKi9cbi8qKlxuICogQ2hhbm5lbCB1c2VkIGJ5IGBiYWNrZ3JvdW5kLWpvYnMtbWFpbmAgdG8gY29vcmRpbmF0ZSBkaXNwYXRjaCB3YWtlLXVwc1xuICogYWNyb3NzIHByb2Nlc3NlcyB2aWEgQmVhY29uLiBXb3JrZXJzIGRvIE5PVCBzdWJzY3JpYmUgdG8gdGhpcyBjaGFubmVsXG4gKiDigJQgdGhleSBhbHJlYWR5IHJlY2VpdmUgam9iLWhhbmRvZmYgbWVzc2FnZXMgb24gdGhlaXIgSnNvblNvY2tldCB0b1xuICogbWFpbjsgdGhpcyBjaGFubmVsIGV4aXN0cyBzbyBjcm9zcy1wcm9jZXNzIGVucXVldWVzIChvciBmdXR1cmVcbiAqIG11bHRpLW1haW4gZGVwbG95bWVudHMpIGNhbiBwb2tlIGFuIGlkbGUgbWFpbiB0byBkcmFpbi5cbiAqL1xuY29uc3QgRElTUEFUQ0hfQ0hBTk5FTCA9IFwidmVsb2Npb3VzLWJhY2tncm91bmQtam9icy1kaXNwYXRjaFwiXG5cbi8qKlxuICogYHNldFRpbWVvdXRgIGlzIGltcGxlbWVudGVkIHdpdGggMzItYml0IHNpZ25lZCBkZWxheXMgb24gTm9kZTsgcGFzc2luZ1xuICogYW55dGhpbmcgbGFyZ2VyIHNpbGVudGx5IGNsYW1wcyB0byAxbXMgYW5kIGZpcmVzIGltbWVkaWF0ZWx5LiBDYXAgdGhlXG4gKiBzY2hlZHVsZWQtam9iIHRpbWVyIGhlcmUgYW5kIHJlLWFybSB3aGVuIGl0IGV4cGlyZXMuXG4gKi9cbmNvbnN0IE1BWF9USU1FUl9NUyA9IDJfMTQ3XzQ4M182NDcgLy8gfjI0LjggZGF5c1xuLyoqIEEgd29ya2VyIHNpbGVudCAobm8gaGVhcnRiZWF0L3JlYWR5L3JlcG9ydCkgbG9uZ2VyIHRoYW4gdGhpcyBpcyBkcm9wcGVkLiAqL1xuY29uc3QgV09SS0VSX1NUQUxFX1RJTUVPVVRfTVMgPSA2MDAwMFxuLyoqIEhvdyBvZnRlbiB0aGUgbWFpbiBzY2FucyB3b3JrZXJzIGZvciBzdGFsZW5lc3MuICovXG5jb25zdCBXT1JLRVJfTElWRU5FU1NfU1dFRVBfTVMgPSAxNTAwMFxuLyoqIEdyYWNlIGZvciB3b3JrZXJzIGZyb20gdGhlIHByZXZpb3VzIG1haW4gZ2VuZXJhdGlvbiB0byByZWNvbm5lY3QgYW5kIGFkb3B0IGxlYXNlcy4gKi9cbmNvbnN0IFdPUktFUl9SRUNPTk5FQ1RfR1JBQ0VfTVMgPSAzMDAwMFxuY29uc3QgR0VORVJBVElPTl9PUlBIQU5FRF9BRlRFUl9NUyA9IDYwICogNjAgKiAxMDAwXG5jb25zdCBXT1JLRVJfUkVDT05ORUNUX0dSQUNFX1ZBTElEQVRJT05fTUVTU0FHRSA9IGB3b3JrZXJSZWNvbm5lY3RHcmFjZU1zIG11c3QgYmUgYW4gaW50ZWdlciBiZXR3ZWVuIDAgYW5kICR7TUFYX1RJTUVSX01TfWBcblxuLyoqXG4gKiBSZXNvbHZlcyBhIHN0YXJ0dXAgcmVjb25uZWN0IGdyYWNlIHdpdGhvdXQgYWxsb3dpbmcgTm9kZSdzIHRpbWVyIG92ZXJmbG93IHRvXG4gKiB0dXJuIGFuIGludGVudGlvbmFsbHkgbG9uZyBncmFjZSBpbnRvIGFuIGltbWVkaWF0ZSByZWNsYWltLlxuICogQHBhcmFtIHtudW1iZXIgfCB1bmRlZmluZWR9IHdvcmtlclJlY29ubmVjdEdyYWNlTXMgLSBSZXF1ZXN0ZWQgcmVjb25uZWN0IGdyYWNlLlxuICogQHJldHVybnMge251bWJlcn0gLSBWYWxpZCB0aW1lciBkZWxheS5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplV29ya2VyUmVjb25uZWN0R3JhY2VNcyh3b3JrZXJSZWNvbm5lY3RHcmFjZU1zKSB7XG4gIGlmICh3b3JrZXJSZWNvbm5lY3RHcmFjZU1zID09PSB1bmRlZmluZWQpIHJldHVybiBXT1JLRVJfUkVDT05ORUNUX0dSQUNFX01TXG4gIGlmICghTnVtYmVyLmlzSW50ZWdlcih3b3JrZXJSZWNvbm5lY3RHcmFjZU1zKSB8fCB3b3JrZXJSZWNvbm5lY3RHcmFjZU1zIDwgMCB8fCB3b3JrZXJSZWNvbm5lY3RHcmFjZU1zID4gTUFYX1RJTUVSX01TKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihXT1JLRVJfUkVDT05ORUNUX0dSQUNFX1ZBTElEQVRJT05fTUVTU0FHRSlcbiAgfVxuXG4gIHJldHVybiB3b3JrZXJSZWNvbm5lY3RHcmFjZU1zXG59XG4vKipcbiAqIFdvcmtlciBleGVjdXRpb24gbW9kZSBjYXBhYmlsaXRpZXMuXG4gKiBAdHlwZSB7V29ya2VyRXhlY3V0aW9uTW9kZUNhcGFiaWxpdHlbXX0gKi9cbmNvbnN0IFdPUktFUl9FWEVDVVRJT05fTU9ERV9DQVBBQklMSVRJRVMgPSBbXG4gIHtleGVjdXRpb25Nb2RlOiBcImlubGluZVwiLCBhY2NlcHRzOiAod29ya2VyKSA9PiB3b3JrZXIuYWNjZXB0c0lubGluZUpvYnMgIT09IGZhbHNlfSxcbiAge2V4ZWN1dGlvbk1vZGU6IFwiZm9ya2VkXCIsIGFjY2VwdHM6ICh3b3JrZXIpID0+IHdvcmtlci5hY2NlcHRzRm9ya2VkSm9icyAhPT0gZmFsc2V9LFxuICAvLyBQb29sZWQgaXMgb3B0LWluOiBvbmx5IHdvcmtlcnMgdGhhdCBleHBsaWNpdGx5IGFkdmVydGlzZSBgYWNjZXB0c1Bvb2xlZGBcbiAgLy8gcmVjZWl2ZSBwb29sZWQgam9icy4gVGhlIGA9PT0gdHJ1ZWAgKHJhdGhlciB0aGFuIGAhPT0gZmFsc2VgKSBjaGVjayBrZWVwcyBhXG4gIC8vIHByZS1wb29sZWQgd29ya2VyIOKAlCB3aGljaCBuZXZlciBzZW5kcyB0aGUgZmllbGQg4oCUIG91dCBvZiB0aGUgcG9vbGVkLWNhcGFibGVcbiAgLy8gc2V0LCBzbyB0aGUgbWFpbiBuZXZlciBkaXNwYXRjaGVzIGEgcG9vbGVkIGpvYiB0byBhIHdvcmtlciB0aGF0IGNhbm5vdCBydW5cbiAgLy8gb25lLiBUaGlzIGlzIHRoZSBjb25zZXJ2YXRpdmUgaGFsZiBvZiB0aGUgZXh0ZW5kZWQgcmVhZGluZXNzIHByb3RvY29sLlxuICB7ZXhlY3V0aW9uTW9kZTogXCJwb29sZWRcIiwgYWNjZXB0czogKHdvcmtlcikgPT4gd29ya2VyLmFjY2VwdHNQb29sZWRKb2JzID09PSB0cnVlICYmICghd29ya2VyLnVzZXNQb29sZWRDYXBhY2l0eUNyZWRpdHMgfHwgd29ya2VyLmF2YWlsYWJsZVBvb2xlZFNsb3RzID4gMCl9LFxuICB7ZXhlY3V0aW9uTW9kZTogXCJzcGF3bmVkXCIsIGFjY2VwdHM6ICh3b3JrZXIpID0+IHdvcmtlci5hY2NlcHRzU3Bhd25lZEpvYnMgIT09IGZhbHNlfVxuXVxuY29uc3QgV09SS0VSX0VYRUNVVElPTl9NT0RFX0NBUEFCSUxJVElFU19CWV9NT0RFID0gbmV3IE1hcChcbiAgV09SS0VSX0VYRUNVVElPTl9NT0RFX0NBUEFCSUxJVElFUy5tYXAoKGNhcGFiaWxpdHkpID0+IFtjYXBhYmlsaXR5LmV4ZWN1dGlvbk1vZGUsIGNhcGFiaWxpdHldKVxuKVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBCYWNrZ3JvdW5kSm9ic01haW4ge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhvc3RdIC0gSG9zdG5hbWUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5wb3J0XSAtIFBvcnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5nZW5lcmF0aW9uSWRdIC0gRXhwbGljaXQgcmVsZWFzZSBnZW5lcmF0aW9uIGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uSW5pdGlhbFN0YXRlfSBbYXJncy5pbml0aWFsR2VuZXJhdGlvblN0YXRlXSAtIEV4cGxpY2l0IGdlbmVyYXRpb24gYm9vdCBzdGF0ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmxpZmVjeWNsZVNvY2tldFBhdGhdIC0gRXhwbGljaXQgbGlmZWN5Y2xlIHNvY2tldCBwYXRoLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3Mud29ya2VyU3RhbGVUaW1lb3V0TXNdIC0gT3ZlcnJpZGUgaG93IGxvbmcgYSBzaWxlbnQgd29ya2VyIG1heSBnbyBiZWZvcmUgYmVpbmcgZHJvcHBlZCAoZGVmYXVsdCA2MDAwMG1zKS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLndvcmtlckxpdmVuZXNzU3dlZXBNc10gLSBPdmVycmlkZSBob3cgb2Z0ZW4gc3RhbGUgd29ya2VycyBhcmUgc3dlcHQgZm9yIChkZWZhdWx0IDE1MDAwbXMpLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3Mud29ya2VyUmVjb25uZWN0R3JhY2VNc10gLSBJbnRlZ2VyIGZyb20gMCB0aHJvdWdoIDIsMTQ3LDQ4Myw2NDcgb3ZlcnJpZGluZyBob3cgbG9uZyBwcmV2aW91cy1nZW5lcmF0aW9uIHdvcmtlcnMgbWF5IHJlY29ubmVjdCBiZWZvcmUgZXhhY3Qgc3RhcnR1cCBsZWFzZXMgYXJlIHJlY2xhaW1lZCAoZGVmYXVsdCAzMDAwMG1zKS5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3BdIC0gV2hldGhlciBzdG9wIG93bnMgY2xvc2luZyB0aGUgY29uZmlndXJhdGlvbidzIGRhdGFiYXNlIHBvb2xzIChkZWZhdWx0IHRydWUpLlxuICAgKiBAcGFyYW0geygpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+fSBbYXJncy5vblN0b3BwZWRdIC0gTGlmZWN5Y2xlIGhvb2sgaW52b2tlZCBhZnRlciB0aGUgbWFpbiBwcm9jZXNzIGZpbmlzaGVzIHN0b3BwaW5nLlxuICAgKiBAcGFyYW0geyhhcmdzOiB7aGFuZG9mZjogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGFuZG9mZiwgam9iOiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9KSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPn0gW2FyZ3MuYWZ0ZXJIYW5kb2ZmQ2xhaW1dIC0gRXhwbGljaXQgaGFuZG9mZi1jbGFpbSBvYnNlcnZhdGlvbiBob29rLlxuICAgKiBAcGFyYW0geyh3b3JrZXI6IEpzb25Tb2NrZXQpID0+IHZvaWR9IFthcmdzLm9uV29ya2VyUmVhZHldIC0gRXhwbGljaXQgcmVhZGluZXNzIG9ic2VydmF0aW9uIGhvb2suXG4gICAqIEBwYXJhbSB7KHdvcmtlcjogSnNvblNvY2tldCkgPT4gdm9pZH0gW2FyZ3Mub25Xb3JrZXJIZWFydGJlYXRdIC0gRXhwbGljaXQgaGVhcnRiZWF0IG9ic2VydmF0aW9uIGhvb2suXG4gICAqIEBwYXJhbSB7KHdvcmtlcklkOiBzdHJpbmcpID0+IHZvaWR9IFthcmdzLm9uV29ya2VyRGlzY29ubmVjdGVkXSAtIEV4cGxpY2l0IGdlbmVyYXRpb24gZGlzY29ubmVjdCBvYnNlcnZhdGlvbiBob29rLlxuICAgKiBAcGFyYW0geyh3b3JrZXJJZDogc3RyaW5nKSA9PiB2b2lkfSBbYXJncy5vbldvcmtlckhhbmRvZmZzUmVsZWFzZWRdIC0gRXhwbGljaXQgZ3JhY2UtZXhwaXJ5IG9ic2VydmF0aW9uIGhvb2suXG4gICAqIEBwYXJhbSB7KGpvYnM6IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd1tdKSA9PiB2b2lkfSBbYXJncy5vblN0YXJ0dXBIYW5kb2Zmc1JlY2xhaW1lZF0gLSBFeHBsaWNpdCBzdGFydHVwIHJlY2xhaW0gb2JzZXJ2YXRpb24gaG9vay5cbiAgICogQHBhcmFtIHsoYXJnczoge2FjY2VwdGVkOiBib29sZWFuLCBqb2JJZDogc3RyaW5nLCBzdGF0dXM6IFwiY29tcGxldGVkXCIgfCBcImZhaWxlZFwiIHwgXCJyZXNjaGVkdWxlZFwifSkgPT4gdm9pZH0gW2FyZ3Mub25Kb2JVcGRhdGVkXSAtIEV4cGxpY2l0IGR1cmFibGUgcmVwb3J0IG9ic2VydmF0aW9uIGhvb2suXG4gICAqIEBwYXJhbSB7e25vdzogKCkgPT4gbnVtYmVyLCBzZXRUaW1lb3V0PzogKGNhbGxiYWNrOiAoKSA9PiB2b2lkLCBkZWxheU1zOiBudW1iZXIpID0+IFJldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVtYmVyLCBjbGVhclRpbWVvdXQ/OiAodGltZXJJZDogUmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudW1iZXIpID0+IHZvaWR9fSBbYXJncy5jbG9ja10gLSBJbmplY3RhYmxlIHdhbGwgY2xvY2sgZm9yIGRldGVybWluaXN0aWMgbGlmZWN5Y2xlIHRlc3RzLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIGhvc3QsIHBvcnQsIGdlbmVyYXRpb25JZDogZXhwbGljaXRHZW5lcmF0aW9uSWQsIGluaXRpYWxHZW5lcmF0aW9uU3RhdGU6IGV4cGxpY2l0SW5pdGlhbEdlbmVyYXRpb25TdGF0ZSwgbGlmZWN5Y2xlU29ja2V0UGF0aDogZXhwbGljaXRMaWZlY3ljbGVTb2NrZXRQYXRoLCB3b3JrZXJTdGFsZVRpbWVvdXRNcywgd29ya2VyTGl2ZW5lc3NTd2VlcE1zLCB3b3JrZXJSZWNvbm5lY3RHcmFjZU1zLCBjbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3AgPSB0cnVlLCBvblN0b3BwZWQsIGFmdGVySGFuZG9mZkNsYWltLCBvbldvcmtlclJlYWR5LCBvbldvcmtlckhlYXJ0YmVhdCwgb25Xb3JrZXJEaXNjb25uZWN0ZWQsIG9uV29ya2VySGFuZG9mZnNSZWxlYXNlZCwgb25TdGFydHVwSGFuZG9mZnNSZWNsYWltZWQsIG9uSm9iVXBkYXRlZCwgY2xvY2t9KSB7XG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMuY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zT25TdG9wID0gY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zT25TdG9wXG4gICAgdGhpcy5vblN0b3BwZWQgPSBvblN0b3BwZWRcbiAgICB0aGlzLmFmdGVySGFuZG9mZkNsYWltID0gYWZ0ZXJIYW5kb2ZmQ2xhaW1cbiAgICB0aGlzLm9uV29ya2VyUmVhZHkgPSBvbldvcmtlclJlYWR5XG4gICAgdGhpcy5vbldvcmtlckhlYXJ0YmVhdCA9IG9uV29ya2VySGVhcnRiZWF0XG4gICAgdGhpcy5vbldvcmtlckRpc2Nvbm5lY3RlZCA9IG9uV29ya2VyRGlzY29ubmVjdGVkXG4gICAgdGhpcy5vbldvcmtlckhhbmRvZmZzUmVsZWFzZWQgPSBvbldvcmtlckhhbmRvZmZzUmVsZWFzZWRcbiAgICB0aGlzLm9uU3RhcnR1cEhhbmRvZmZzUmVjbGFpbWVkID0gb25TdGFydHVwSGFuZG9mZnNSZWNsYWltZWRcbiAgICB0aGlzLm9uSm9iVXBkYXRlZCA9IG9uSm9iVXBkYXRlZFxuICAgIHRoaXMuY2xvY2sgPSB7XG4gICAgICBjbGVhclRpbWVvdXQ6IGNsb2NrPy5jbGVhclRpbWVvdXQgfHwgKCh0aW1lcklkKSA9PiBjbGVhclRpbWVvdXQodGltZXJJZCkpLFxuICAgICAgbm93OiBjbG9jaz8ubm93IHx8ICgoKSA9PiBEYXRlLm5vdygpKSxcbiAgICAgIHNldFRpbWVvdXQ6IGNsb2NrPy5zZXRUaW1lb3V0IHx8ICgoY2FsbGJhY2ssIGRlbGF5TXMpID0+IHNldFRpbWVvdXQoY2FsbGJhY2ssIGRlbGF5TXMpKVxuICAgIH1cbiAgICBjb25zdCBjb25maWcgPSBjb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKClcbiAgICBjb25zdCBnZW5lcmF0aW9uQ29uZmlnID0gY29uZmlndXJhdGlvbi5yZXNvbHZlQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uQ29uZmlnKHtcbiAgICAgIGdlbmVyYXRpb25JZDogZXhwbGljaXRHZW5lcmF0aW9uSWQsXG4gICAgICBpbml0aWFsR2VuZXJhdGlvblN0YXRlOiBleHBsaWNpdEluaXRpYWxHZW5lcmF0aW9uU3RhdGUsXG4gICAgICBsaWZlY3ljbGVTb2NrZXRQYXRoOiBleHBsaWNpdExpZmVjeWNsZVNvY2tldFBhdGgsXG4gICAgICBzb3VyY2VOYW1lOiBcIkJhY2tncm91bmRKb2JzTWFpblwiXG4gICAgfSlcbiAgICB0aGlzLmdlbmVyYXRpb25JZCA9IGdlbmVyYXRpb25Db25maWcuZ2VuZXJhdGlvbklkXG4gICAgdGhpcy5pbml0aWFsR2VuZXJhdGlvblN0YXRlID0gZ2VuZXJhdGlvbkNvbmZpZy5pbml0aWFsR2VuZXJhdGlvblN0YXRlXG4gICAgdGhpcy5saWZlY3ljbGVTb2NrZXRQYXRoID0gZ2VuZXJhdGlvbkNvbmZpZy5saWZlY3ljbGVTb2NrZXRQYXRoXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkxpZmVjeWNsZVN0YXRlfSAqL1xuICAgIHRoaXMubGlmZWN5Y2xlU3RhdGUgPSBcInN0YXJ0aW5nXCJcbiAgICB0aGlzLl9hY3RpdmVPd25lcnNoaXBSZWFkeSA9IGZhbHNlXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2FjdGl2YXRpb25Qcm9taXNlID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX3JldGlyZW1lbnRQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHtTZXQ8SnNvblNvY2tldD59ICovXG4gICAgdGhpcy5jYW5kaWRhdGVSZWFkeVdvcmtlcnMgPSBuZXcgU2V0KClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIHt3b3JrZXI6IEpzb25Tb2NrZXQsIHRpbWVyOiBSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bWJlcn0+fSAqL1xuICAgIHRoaXMuZGlzY29ubmVjdGVkV29ya2VycyA9IG5ldyBNYXAoKVxuICAgIHRoaXMuX2xpZmVjeWNsZVJlcXVlc3RMZWFzZXMgPSAwXG4gICAgdGhpcy5fYWN0aXZlTm9uV29ya2VyUmVxdWVzdHMgPSAwXG4gICAgLyoqXG4gICAgICogUmVzb2x2ZXMgc3RvcCBvYnNlcnZhdGlvbi5cbiAgICAgKiBAdHlwZSB7KCkgPT4gdm9pZH1cbiAgICAgKi9cbiAgICB0aGlzLl9yZXNvbHZlU3RvcHBlZCA9ICgpID0+IHt9XG4gICAgdGhpcy5fc3RvcHBlZFByb21pc2UgPSBuZXcgUHJvbWlzZSgoLyoqIEB0eXBlIHsodmFsdWU6IHZvaWQpID0+IHZvaWR9ICovIHJlc29sdmUpID0+IHsgdGhpcy5fcmVzb2x2ZVN0b3BwZWQgPSByZXNvbHZlIH0pXG4gICAgdGhpcy5ob3N0ID0gaG9zdCB8fCBjb25maWcuaG9zdFxuICAgIHRoaXMucG9ydCA9IHR5cGVvZiBwb3J0ID09PSBcIm51bWJlclwiID8gcG9ydCA6IGNvbmZpZy5wb3J0XG4gICAgdGhpcy5kaXNwYXRjaFN0cmF0ZWd5ID0gY29uZmlnLmRpc3BhdGNoU3RyYXRlZ3lcbiAgICB0aGlzLnBvbGxJbnRlcnZhbE1zID0gY29uZmlnLnBvbGxJbnRlcnZhbE1zXG4gICAgdGhpcy5kcmFpblN0b3JlT3BlcmF0aW9uVGltZW91dE1zID0gY29uZmlnLmRyYWluU3RvcmVPcGVyYXRpb25UaW1lb3V0TXNcbiAgICB0aGlzLnJldGVudGlvbiA9IGNvbmZpZy5yZXRlbnRpb25cbiAgICAvLyBBIHdvcmtlciB0aGF0IHN0b3BzIHNlbmRpbmcgYW55dGhpbmcgKGhlYXJ0YmVhdC9yZWFkeS9yZXBvcnQpIGZvciB0aGlzXG4gICAgLy8gbG9uZyBpcyB0cmVhdGVkIGFzIHdlZGdlZC9kZWFkOiBpdHMgbGVhc2VzIGFyZSByZWxlYXNlZCBhbmQgaXQgaXMgZHJvcHBlZC5cbiAgICB0aGlzLndvcmtlclN0YWxlVGltZW91dE1zID0gdHlwZW9mIHdvcmtlclN0YWxlVGltZW91dE1zID09PSBcIm51bWJlclwiICYmIHdvcmtlclN0YWxlVGltZW91dE1zID49IDEgPyB3b3JrZXJTdGFsZVRpbWVvdXRNcyA6IFdPUktFUl9TVEFMRV9USU1FT1VUX01TXG4gICAgdGhpcy53b3JrZXJMaXZlbmVzc1N3ZWVwTXMgPSB0eXBlb2Ygd29ya2VyTGl2ZW5lc3NTd2VlcE1zID09PSBcIm51bWJlclwiICYmIHdvcmtlckxpdmVuZXNzU3dlZXBNcyA+PSAxID8gd29ya2VyTGl2ZW5lc3NTd2VlcE1zIDogV09SS0VSX0xJVkVORVNTX1NXRUVQX01TXG4gICAgdGhpcy53b3JrZXJSZWNvbm5lY3RHcmFjZU1zID0gbm9ybWFsaXplV29ya2VyUmVjb25uZWN0R3JhY2VNcyh3b3JrZXJSZWNvbm5lY3RHcmFjZU1zKVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9hZGFwdGVyLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5hZGFwdGVyID0gdW5kZWZpbmVkXG4gICAgdGhpcy5sb2dnZXIgPSBuZXcgTG9nZ2VyKHRoaXMpXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtTZXQ8SnNvblNvY2tldD59ICovXG4gICAgdGhpcy53b3JrZXJzID0gbmV3IFNldCgpXG4gICAgLyoqIEB0eXBlIHtTZXQ8SnNvblNvY2tldD59ICovXG4gICAgdGhpcy5jb25uZWN0aW9ucyA9IG5ldyBTZXQoKVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7U2V0PEpzb25Tb2NrZXQ+fSAqL1xuICAgIHRoaXMucmVhZHlXb3JrZXJzID0gbmV3IFNldCgpXG4gICAgLyoqXG4gICAgICogQWN0aXZlIGR1cmFibGUgaGFuZG9mZnMga2V5ZWQgYnkgdGhlIGV4YWN0IHdvcmtlciBzb2NrZXQgdGhhdCByZWNlaXZlZCB0aGVtLlxuICAgICAqIEB0eXBlIHtNYXA8SnNvblNvY2tldCwgTWFwPHN0cmluZywgc3RyaW5nPj59ICovXG4gICAgdGhpcy53b3JrZXJIYW5kb2ZmcyA9IG5ldyBNYXAoKVxuICAgIC8qKlxuICAgICAqIEV4YWN0IGNhbGxlci1nZW5lcmF0ZWQgbGVhc2VzIHdob3NlIGNsYWltIG91dGNvbWUgd2FzIGFtYmlndW91cyBvciB3aG9zZVxuICAgICAqIHByZS1kaXNwYXRjaCByZWxlYXNlIGhhcyBub3QgeWV0IGJlZW4gYWNrbm93bGVkZ2VkLiBSZXRhaW5lZCB1bnRpbCBhXG4gICAgICogZmVuY2VkIHJldHVybiBzdWNjZWVkcyAoaW5jbHVkaW5nIGFuIGV4YWN0IG5vLW9wKS5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywgc3RyaW5nPn0gKi9cbiAgICB0aGlzLnBlbmRpbmdIYW5kb2ZmUmVjb3ZlcmllcyA9IG5ldyBNYXAoKVxuICAgIC8qKlxuICAgICAqIEhhbmRvZmYtYWRvcHRpb24gcXVlcmllcyBzdGFydGVkIGJ5IHdvcmtlciBoZWxsbyBtZXNzYWdlcy4gU2h1dGRvd24gbXVzdFxuICAgICAqIHdhaXQgZm9yIHRoZXNlIGJlZm9yZSBjbG9zaW5nIHRoZSBjb25maWd1cmF0aW9uJ3MgZGF0YWJhc2UgcG9vbHMuXG4gICAgICogQHR5cGUge1NldDxQcm9taXNlPHZvaWQ+Pn0gKi9cbiAgICB0aGlzLmluZmxpZ2h0V29ya2VySGFuZG9mZkFkb3B0aW9ucyA9IG5ldyBTZXQoKVxuICAgIC8qKlxuICAgICAqIFdvcmtlciBpZHMgd2hvc2UgaGFuZG9mZnMgd2VyZSBzdWNjZXNzZnVsbHkgYWRvcHRlZCBieSBhIHN0aWxsLWxpdmVcbiAgICAgKiBjb25uZWN0aW9uIGluIHRoaXMgbWFpbiBnZW5lcmF0aW9uLlxuICAgICAqIEB0eXBlIHtTZXQ8c3RyaW5nPn1cbiAgICAgKi9cbiAgICB0aGlzLnJlY29ubmVjdGVkV29ya2VySWRzID0gbmV3IFNldCgpXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JIYW5kb2ZmU25hcHNob3RbXX0gKi9cbiAgICB0aGlzLnN0YXJ0dXBIYW5kb2ZmU25hcHNob3QgPSBbXVxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPltdfSAqL1xuICAgIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmQWRvcHRpb25zQXREZWFkbGluZSA9IFtdXG4gICAgdGhpcy5fc3RhcnR1cEhhbmRvZmZHcmFjZUVsYXBzZWQgPSBmYWxzZVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7bmV0LlNlcnZlciB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLnNlcnZlciA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fcG9sbFRpbWVyID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bWJlciB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9zY2hlZHVsZWRUaW1lciA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fZXJyb3JSZXRyeVRpbWVyID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9vcnBoYW5UaW1lciA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0SW50ZXJ2YWw+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX3dvcmtlclN0YWxlVGltZXIgPSB1bmRlZmluZWRcbiAgICAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVtYmVyIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVRpbWVyID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVByb21pc2UgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge0JhY2tncm91bmRKb2JzU2NoZWR1bGVyIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuc2NoZWR1bGVyID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fZHJhaW5pbmcgPSBmYWxzZVxuICAgIHRoaXMuX3JlZHJhaW5RdWV1ZWQgPSBmYWxzZVxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9kcmFpblByb21pc2UgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9zdG9wcGVkID0gZmFsc2VcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5zdG9wUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7KCgpID0+IHZvaWQpIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX3Vuc3Vic2NyaWJlQmVhY29uID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHsoKC4uLmFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gdm9pZCkgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fYmVhY29uQ29ubmVjdEhhbmRsZXIgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge2ltcG9ydChcIi4uL2JlYWNvbi9jbGllbnQuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4uL2JlYWNvbi9pbi1wcm9jZXNzLWNsaWVudC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2JlYWNvbkNsaWVudCA9IHVuZGVmaW5lZFxuICAgIC8qKiBAdHlwZSB7QmFja2dyb3VuZEpvYnNMaWZlY3ljbGVDb250cm9sU2VydmVyIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMubGlmZWN5Y2xlQ29udHJvbFNlcnZlciA9IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIENvbXBhdGliaWxpdHkgYWxpYXMgZm9yIGludGVncmF0aW9ucyB0aGF0IGluc3BlY3QgdGhlIGFjdGl2ZSBtYWluIHN0b3JlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9hZGFwdGVyLmpzXCIpLmRlZmF1bHR9IC0gQWRhcHRlciBhY3F1aXJlZCBieSBzdGFydC5cbiAgICovXG4gIGdldCBzdG9yZSgpIHtcbiAgICBpZiAoIXRoaXMuYWRhcHRlcikgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIG1haW4gaGFzIG5vdCBhY3F1aXJlZCBpdHMgYWRhcHRlclwiKVxuXG4gICAgcmV0dXJuIHRoaXMuYWRhcHRlclxuICB9XG5cbiAgLyoqXG4gICAqIFByZXNlcnZlcyB0aGUgaGlzdG9yaWNhbCBzdWJjbGFzcyBzZWFtIHdoaWxlIGtlZXBpbmcgb25lIGFkYXB0ZXIgcmVmZXJlbmNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vYWRhcHRlci5qc1wiKS5kZWZhdWx0fSBhZGFwdGVyIC0gQWRhcHRlciB0byBhc3NpZ24uXG4gICAqL1xuICBzZXQgc3RvcmUoYWRhcHRlcikge1xuICAgIHRoaXMuYWRhcHRlciA9IGFkYXB0ZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0YXJ0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGxpc3RlbmluZy5cbiAgICovXG4gIGFzeW5jIHN0YXJ0KCkge1xuICAgIHRoaXMuX3N0b3BwZWQgPSBmYWxzZVxuICAgIHRoaXMuc3RvcFByb21pc2UgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9hY3RpdmVPd25lcnNoaXBSZWFkeSA9IGZhbHNlXG4gICAgdGhpcy5saWZlY3ljbGVTdGF0ZSA9IFwic3RhcnRpbmdcIlxuICAgIHRoaXMuX3N0b3BwZWRQcm9taXNlID0gbmV3IFByb21pc2UoKC8qKiBAdHlwZSB7KHZhbHVlOiB2b2lkKSA9PiB2b2lkfSAqLyByZXNvbHZlKSA9PiB7IHRoaXMuX3Jlc29sdmVTdG9wcGVkID0gcmVzb2x2ZSB9KVxuICAgIHRoaXMucmVjb25uZWN0ZWRXb3JrZXJJZHMuY2xlYXIoKVxuICAgIHRoaXMuc3RhcnR1cEhhbmRvZmZTbmFwc2hvdCA9IFtdXG4gICAgdGhpcy5fc3RhcnR1cEhhbmRvZmZBZG9wdGlvbnNBdERlYWRsaW5lID0gW11cbiAgICB0aGlzLl9zdGFydHVwSGFuZG9mZkdyYWNlRWxhcHNlZCA9IGZhbHNlXG4gICAgdGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIHRoaXMuY29uZmlndXJhdGlvbi5zZXRDdXJyZW50KClcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uaW5pdGlhbGl6ZSh7dHlwZTogXCJiYWNrZ3JvdW5kLWpvYnMtbWFpblwifSlcbiAgICAgIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5jb25uZWN0QmVhY29uKHtwZWVyVHlwZTogXCJiYWNrZ3JvdW5kLWpvYnMtbWFpblwifSlcblxuICAgICAgaWYgKCF0aGlzLmFkYXB0ZXIpIHtcbiAgICAgICAgdGhpcy5hZGFwdGVyID0gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmFjcXVpcmVSZWFkeUJhY2tncm91bmRKb2JzQWRhcHRlcigpXG4gICAgICB9XG4gICAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQgJiYgIXRoaXMuYWRhcHRlci5zdXBwb3J0c1JlbGVhc2VTY29wZWRHZW5lcmF0aW9ucygpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlRoZSBjb25maWd1cmVkIGJhY2tncm91bmQgam9icyBhZGFwdGVyIGRvZXMgbm90IHN1cHBvcnQgcmVsZWFzZS1zY29wZWQgZ2VuZXJhdGlvbnNcIilcbiAgICAgIH1cbiAgICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCAmJiAhdGhpcy5hZGFwdGVyLnN1cHBvcnRzT3duZWRFbnF1ZXVlRnJvbUhhbmRvZmYoKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJUaGUgY29uZmlndXJlZCBiYWNrZ3JvdW5kIGpvYnMgYWRhcHRlciBkb2VzIG5vdCBzdXBwb3J0IGF0b21pYyBvd25lZC1oYW5kb2ZmIGVucXVldWVcIilcbiAgICAgIH1cblxuICAgICAgaWYgKCF0aGlzLmdlbmVyYXRpb25JZCB8fCB0aGlzLmluaXRpYWxHZW5lcmF0aW9uU3RhdGUgIT09IFwiY2FuZGlkYXRlXCIpIHtcbiAgICAgICAgdGhpcy5zdGFydHVwSGFuZG9mZlNuYXBzaG90ID0gYXdhaXQgdGhpcy5fZ2VuZXJhdGlvbk93bmVkSGFuZG9mZlNuYXBzaG90KClcbiAgICAgIH1cbiAgICAgIGNvbnN0IHNlcnZlciA9IG5ldC5jcmVhdGVTZXJ2ZXIoKHNvY2tldCkgPT4gdGhpcy5faGFuZGxlQ29ubmVjdGlvbihzb2NrZXQpKVxuICAgICAgdGhpcy5zZXJ2ZXIgPSBzZXJ2ZXJcblxuICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBzZXJ2ZXIub25jZShcImVycm9yXCIsIHJlamVjdClcbiAgICAgICAgc2VydmVyLmxpc3Rlbih0aGlzLnBvcnQsIHRoaXMuaG9zdCwgKCkgPT4gcmVzb2x2ZSh1bmRlZmluZWQpKVxuICAgICAgfSlcblxuICAgICAgY29uc3QgYWRkcmVzcyA9IHNlcnZlci5hZGRyZXNzKClcbiAgICAgIGlmIChhZGRyZXNzICYmIHR5cGVvZiBhZGRyZXNzID09PSBcIm9iamVjdFwiKSB7XG4gICAgICAgIHRoaXMucG9ydCA9IGFkZHJlc3MucG9ydFxuICAgICAgfVxuXG4gICAgICB0aGlzLmxpZmVjeWNsZVN0YXRlID0gdGhpcy5nZW5lcmF0aW9uSWQgPyB0aGlzLmluaXRpYWxHZW5lcmF0aW9uU3RhdGUgOiBcImFjdGl2ZVwiXG5cbiAgICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCAmJiB0aGlzLmxpZmVjeWNsZVNvY2tldFBhdGgpIHtcbiAgICAgICAgdGhpcy5saWZlY3ljbGVDb250cm9sU2VydmVyID0gbmV3IEJhY2tncm91bmRKb2JzTGlmZWN5Y2xlQ29udHJvbFNlcnZlcih7XG4gICAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgICAgIGdlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWQsXG4gICAgICAgICAgbWFpbjogdGhpcyxcbiAgICAgICAgICBzb2NrZXRQYXRoOiB0aGlzLmxpZmVjeWNsZVNvY2tldFBhdGhcbiAgICAgICAgfSlcbiAgICAgICAgYXdhaXQgdGhpcy5saWZlY3ljbGVDb250cm9sU2VydmVyLnN0YXJ0KClcbiAgICAgIH1cblxuICAgICAgdGhpcy5fd29ya2VyU3RhbGVUaW1lciA9IHNldEludGVydmFsKCgpID0+IHtcbiAgICAgICAgdm9pZCB0aGlzLl9zd2VlcFN0YWxlV29ya2VycygpXG4gICAgICB9LCB0aGlzLndvcmtlckxpdmVuZXNzU3dlZXBNcylcblxuICAgICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwiYWN0aXZlXCIpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fc3RhcnRBY3RpdmVPd25lcnNoaXAoXCJhY3RpdmVcIilcbiAgICAgIH0gZWxzZSBpZiAodGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJyZXRpcmVkXCIpIHtcbiAgICAgICAgdGhpcy5fc3RhcnRHZW5lcmF0aW9uUmVjb3ZlcnlPd25lcnNoaXAoKVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBsZXQgY2xlYW51cEVycm9yXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuc3RvcCgpXG4gICAgICB9IGNhdGNoIChjYXVnaHRDbGVhbnVwRXJyb3IpIHtcbiAgICAgICAgY2xlYW51cEVycm9yID0gY2F1Z2h0Q2xlYW51cEVycm9yXG4gICAgICB9XG5cbiAgICAgIGlmIChjbGVhbnVwRXJyb3IpIHtcbiAgICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKFxuICAgICAgICAgIFtlcnJvciwgY2xlYW51cEVycm9yXSxcbiAgICAgICAgICBcIkJhY2tncm91bmQgam9icyBtYWluIHN0YXJ0dXAgYW5kIGNsZWFudXAgZmFpbGVkXCIsXG4gICAgICAgICAge2NhdXNlOiBlcnJvcn1cbiAgICAgICAgKVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0b3AuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY2xvc2VkLlxuICAgKi9cbiAgc3RvcCgpIHtcbiAgICBpZiAoIXRoaXMuc3RvcFByb21pc2UpIHRoaXMuc3RvcFByb21pc2UgPSB0aGlzLl9zdG9wKClcblxuICAgIHJldHVybiB0aGlzLnN0b3BQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0aGUgbWFpbi1wcm9jZXNzIHNodXRkb3duIGxpZmVjeWNsZSBvbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNsb3NlZC5cbiAgICovXG4gIGFzeW5jIF9zdG9wKCkge1xuICAgIHRoaXMuX3N0b3BwZWQgPSB0cnVlXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgc2h1dGRvd25MaWZlY3ljbGUoe1xuICAgICAgICBvblN0b3BwZWQ6IHRoaXMub25TdG9wcGVkLFxuICAgICAgICBzaHV0ZG93bjogYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIHRoaXMuX2Nsb3NlV29ya2VycygpXG4gICAgICAgICAgdGhpcy5fY2xlYXJUaW1lcnMoKVxuICAgICAgICAgIHRoaXMuX2Rpc2Nvbm5lY3RCZWFjb25IYW5kbGVycygpXG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuc2NoZWR1bGVyPy5zdG9wKClcbiAgICAgICAgICAgIGlmICh0aGlzLl9kcmFpblByb21pc2UpIGF3YWl0IHRoaXMuX2RyYWluUHJvbWlzZVxuICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICBhd2FpdCB0aGlzLl9kcmFpbldvcmtlckhhbmRvZmZBZG9wdGlvbnMoKVxuICAgICAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLl9kcmFpblN0YXJ0dXBIYW5kb2ZmUmVjbGFpbSgpXG4gICAgICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5fc3RvcEJlYWNvbkFuZFNlcnZlcigpXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuYWRhcHRlciA9IHVuZGVmaW5lZFxuICAgICAgdGhpcy5saWZlY3ljbGVTdGF0ZSA9IFwic3RvcHBlZFwiXG4gICAgICB0aGlzLl9yZXNvbHZlU3RvcHBlZCgpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xvc2Ugd29ya2Vycy5cbiAgICogQHJldHVybnMge3ZvaWR9ICovXG4gIF9jbG9zZVdvcmtlcnMoKSB7XG4gICAgZm9yIChjb25zdCBjb25uZWN0aW9uIG9mIHRoaXMuY29ubmVjdGlvbnMpIHtcbiAgICAgIGNvbm5lY3Rpb24uY2xvc2UoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsZWFyIHRpbWVycy5cbiAgICogQHJldHVybnMge3ZvaWR9ICovXG4gIF9jbGVhclRpbWVycygpIHtcbiAgICBpZiAodGhpcy5fcG9sbFRpbWVyKSBjbGVhckludGVydmFsKHRoaXMuX3BvbGxUaW1lcilcbiAgICBpZiAodGhpcy5fc2NoZWR1bGVkVGltZXIpIHRoaXMuY2xvY2suY2xlYXJUaW1lb3V0KHRoaXMuX3NjaGVkdWxlZFRpbWVyKVxuICAgIGlmICh0aGlzLl9lcnJvclJldHJ5VGltZXIpIGNsZWFyVGltZW91dCh0aGlzLl9lcnJvclJldHJ5VGltZXIpXG4gICAgaWYgKHRoaXMuX29ycGhhblRpbWVyKSBjbGVhckludGVydmFsKHRoaXMuX29ycGhhblRpbWVyKVxuICAgIGlmICh0aGlzLl93b3JrZXJTdGFsZVRpbWVyKSBjbGVhckludGVydmFsKHRoaXMuX3dvcmtlclN0YWxlVGltZXIpXG4gICAgaWYgKHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVRpbWVyKSB0aGlzLmNsb2NrLmNsZWFyVGltZW91dCh0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1UaW1lcilcbiAgICBmb3IgKGNvbnN0IHt0aW1lcn0gb2YgdGhpcy5kaXNjb25uZWN0ZWRXb3JrZXJzLnZhbHVlcygpKSB0aGlzLmNsb2NrLmNsZWFyVGltZW91dCh0aW1lcilcbiAgICB0aGlzLmRpc2Nvbm5lY3RlZFdvcmtlcnMuY2xlYXIoKVxuICAgIHRoaXMuX3BvbGxUaW1lciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX3NjaGVkdWxlZFRpbWVyID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fZXJyb3JSZXRyeVRpbWVyID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fb3JwaGFuVGltZXIgPSB1bmRlZmluZWRcbiAgICB0aGlzLl93b3JrZXJTdGFsZVRpbWVyID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltVGltZXIgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRpc2Nvbm5lY3QgYmVhY29uIGhhbmRsZXJzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gKi9cbiAgX2Rpc2Nvbm5lY3RCZWFjb25IYW5kbGVycygpIHtcbiAgICBpZiAodGhpcy5fdW5zdWJzY3JpYmVCZWFjb24pIHtcbiAgICAgIHRoaXMuX3Vuc3Vic2NyaWJlQmVhY29uKClcbiAgICAgIHRoaXMuX3Vuc3Vic2NyaWJlQmVhY29uID0gdW5kZWZpbmVkXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX2JlYWNvbkNsaWVudCAmJiB0aGlzLl9iZWFjb25Db25uZWN0SGFuZGxlcikge1xuICAgICAgdGhpcy5fYmVhY29uQ2xpZW50Lm9mZihcImNvbm5lY3RcIiwgdGhpcy5fYmVhY29uQ29ubmVjdEhhbmRsZXIpXG4gICAgfVxuICAgIHRoaXMuX2JlYWNvbkNvbm5lY3RIYW5kbGVyID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fYmVhY29uQ2xpZW50ID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdG9wIGJlYWNvbiBhbmQgc2VydmVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgYXN5bmMgX3N0b3BCZWFjb25BbmRTZXJ2ZXIoKSB7XG4gICAgYXdhaXQgcnVuU2h1dGRvd25TdGVwcyh7XG4gICAgICBtZXNzYWdlOiBcIkJhY2tncm91bmQgam9icyBtYWluIGFwcGxpY2F0aW9uIGFuZCBmcmFtZXdvcmsgc2h1dGRvd24gZmFpbGVkXCIsXG4gICAgICBzdGVwczogW1xuICAgICAgICBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubGlmZWN5Y2xlQ29udHJvbFNlcnZlcj8uY2xvc2UoKVxuICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICB0aGlzLmxpZmVjeWNsZUNvbnRyb2xTZXJ2ZXIgPSB1bmRlZmluZWRcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIC4uLih0aGlzLmNsb3NlRGF0YWJhc2VDb25uZWN0aW9uc09uU3RvcFxuICAgICAgICAgID8gW2FzeW5jICgpID0+IGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5zaHV0ZG93bigpXVxuICAgICAgICAgIDogW10pLFxuICAgICAgICBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uZGlzY29ubmVjdEJlYWNvbigpLFxuICAgICAgICBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLl9jbG9zZVNlcnZlcigpLFxuICAgICAgICBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgaWYgKHRoaXMuY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zT25TdG9wKSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zKClcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmNsb3NlQmFja2dyb3VuZEpvYnNBZGFwdGVyKClcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIF1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xvc2Ugc2VydmVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgYXN5bmMgX2Nsb3NlU2VydmVyKCkge1xuICAgIGlmICghdGhpcy5zZXJ2ZXIpIHJldHVyblxuXG4gICAgY29uc3Qge3NlcnZlcn0gPSB0aGlzXG4gICAgdGhpcy5zZXJ2ZXIgPSB1bmRlZmluZWRcbiAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gc2VydmVyLmNsb3NlKCgpID0+IHJlc29sdmUodW5kZWZpbmVkKSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcG9ydC5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBCb3VuZCBwb3J0LlxuICAgKi9cbiAgZ2V0UG9ydCgpIHtcbiAgICByZXR1cm4gdGhpcy5wb3J0XG4gIH1cblxuICAvKipcbiAgICogR2V0cyB0aGUgbGlmZWN5Y2xlIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25MaWZlY3ljbGVTdGF0ZX0gLSBDdXJyZW50IGxpZmVjeWNsZSBzdGF0ZS5cbiAgICovXG4gIGdldExpZmVjeWNsZVN0YXRlKCkgeyByZXR1cm4gdGhpcy5saWZlY3ljbGVTdGF0ZSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYSBwcm9taXNlIHRoYXQgc2V0dGxlcyBvbmx5IGFmdGVyIHRoZSBtYWluIGhhcyBmdWxseSBzdG9wcGVkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBTdG9wIGNvbXBsZXRpb24uXG4gICAqL1xuICBhc3luYyB3YWl0VW50aWxTdG9wcGVkKCkgeyBhd2FpdCB0aGlzLl9zdG9wcGVkUHJvbWlzZSB9XG5cbiAgLyoqXG4gICAqIFNuYXBzaG90cyBvbmx5IGV4YWN0IGR1cmFibGUgb3duZXJzIGZyb20gdGhpcyByZWxlYXNlIGdlbmVyYXRpb24uXG4gICAqIExlZ2FjeSBtb2RlIGludGVudGlvbmFsbHkgcmV0YWlucyBpdHMgaGlzdG9yaWNhbCBnbG9iYWwgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhhbmRvZmZTbmFwc2hvdFtdPn0gLSBPd25lZCBzbmFwc2hvdC5cbiAgICovXG4gIGFzeW5jIF9nZW5lcmF0aW9uT3duZWRIYW5kb2ZmU25hcHNob3QoKSB7XG4gICAgY29uc3QgaGFuZG9mZnMgPSBhd2FpdCB0aGlzLnN0b3JlLnNuYXBzaG90SGFuZGVkT2ZmSm9icygpXG5cbiAgICBpZiAoIXRoaXMuZ2VuZXJhdGlvbklkKSByZXR1cm4gaGFuZG9mZnNcbiAgICBjb25zdCBnZW5lcmF0aW9uSWQgPSB0aGlzLmdlbmVyYXRpb25JZFxuXG4gICAgcmV0dXJuIGhhbmRvZmZzLmZpbHRlcigoe3dvcmtlcklkfSkgPT4gd29ya2VySWRCZWxvbmdzVG9HZW5lcmF0aW9uKHtnZW5lcmF0aW9uSWQsIHdvcmtlcklkfSkpXG4gIH1cblxuICAvKipcbiAgICogQWNxdWlyZXMgc2NoZWR1bGluZyBhbmQgZGlzcGF0Y2ggb3duZXJzaGlwIGZvciBhbiBhY3RpdmUgZ2VuZXJhdGlvbi5cbiAgICogQHBhcmFtIHtcImFjdGl2ZVwiIHwgXCJjYW5kaWRhdGVcIn0gZXhwZWN0ZWRMaWZlY3ljbGVTdGF0ZSAtIFN0YXRlIHRoYXQgc3RpbGwgb3ducyBhY3RpdmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIGFjdGl2ZSBvd25lcnNoaXAgd2FzIGVzdGFibGlzaGVkLlxuICAgKi9cbiAgYXN5bmMgX3N0YXJ0QWN0aXZlT3duZXJzaGlwKGV4cGVjdGVkTGlmZWN5Y2xlU3RhdGUpIHtcbiAgICBhd2FpdCB0aGlzLnN0b3JlLnJlY29uY2lsZVF1ZXVlQ29uY3VycmVuY3koKVxuICAgIGlmICh0aGlzLmxpZmVjeWNsZVN0YXRlICE9PSBleHBlY3RlZExpZmVjeWNsZVN0YXRlKSByZXR1cm4gZmFsc2VcbiAgICB0aGlzLl9zZXR1cERpc3BhdGNoVHJpZ2dlcnMoKVxuICAgIHRoaXMuX3N0YXJ0T3JwaGFuU3dlZXAoKVxuICAgIGF3YWl0IHRoaXMuX3N0YXJ0U2NoZWR1bGVyKClcbiAgICBpZiAodGhpcy5saWZlY3ljbGVTdGF0ZSAhPT0gZXhwZWN0ZWRMaWZlY3ljbGVTdGF0ZSkge1xuICAgICAgaWYgKHRoaXMuc2NoZWR1bGVyKSBhd2FpdCB0aGlzLnNjaGVkdWxlci5zdG9wKClcbiAgICAgIHRoaXMuc2NoZWR1bGVyID0gdW5kZWZpbmVkXG4gICAgICB0aGlzLl9jbGVhckRpc3BhdGNoVGltZXJzKClcbiAgICAgIHRoaXMuX2Rpc2Nvbm5lY3RCZWFjb25IYW5kbGVycygpXG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG4gICAgdGhpcy5fYWN0aXZlT3duZXJzaGlwUmVhZHkgPSB0cnVlXG4gICAgdGhpcy5fY3JlZGl0UmVhZHlXb3JrZXJzKClcbiAgICBhd2FpdCB0aGlzLl9kcmFpbigpXG4gICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IGV4cGVjdGVkTGlmZWN5Y2xlU3RhdGUpIHRoaXMuX3NldHVwU3RhcnR1cEhhbmRvZmZSZWNsYWltKClcbiAgICByZXR1cm4gdGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gZXhwZWN0ZWRMaWZlY3ljbGVTdGF0ZVxuICB9XG5cbiAgLyoqIFN0YXJ0cyBleGFjdCByZWNvdmVyeSBkdXRpZXMgd2l0aG91dCBhY3F1aXJpbmcgZ2xvYmFsIGRpc3BhdGNoIG93bmVyc2hpcC4gKi9cbiAgX3N0YXJ0R2VuZXJhdGlvblJlY292ZXJ5T3duZXJzaGlwKCkge1xuICAgIHRoaXMuX3NldHVwU3RhcnR1cEhhbmRvZmZSZWNsYWltKClcbiAgICB0aGlzLl9zdGFydE9ycGhhblN3ZWVwKClcbiAgICB0aGlzLl9tYXliZVN0b3BSZXRpcmVkKClcbiAgfVxuXG4gIC8qKiBTdGFydHMgdGhlIGdlbmVyYXRpb24tZmVuY2VkIG9ycGhhbiBzd2VlcC4gKi9cbiAgX3N0YXJ0T3JwaGFuU3dlZXAoKSB7XG4gICAgaWYgKHRoaXMuX29ycGhhblRpbWVyKSByZXR1cm5cblxuICAgIHRoaXMuX29ycGhhblRpbWVyID0gc2V0SW50ZXJ2YWwoKCkgPT4geyB2b2lkIHRoaXMuX3N3ZWVwT3JwaGFucygpIH0sIDYwMDAwKVxuICB9XG5cbiAgLyoqXG4gICAqIFN0YXJ0cyBzY2hlZHVsZSBvd25lcnNoaXAgZXhhY3RseSBvbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBzY2hlZHVsZXMgYXJlIGxvYWRlZC5cbiAgICovXG4gIGFzeW5jIF9zdGFydFNjaGVkdWxlcigpIHtcbiAgICBpZiAodGhpcy5zY2hlZHVsZXIpIHJldHVyblxuXG4gICAgdGhpcy5zY2hlZHVsZXIgPSBuZXcgQmFja2dyb3VuZEpvYnNTY2hlZHVsZXIoe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgZW5xdWV1ZUpvYjogYXN5bmMgKHthcmdzLCBqb2JDbGFzcywgb3B0aW9uc30pID0+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5zdG9yZS5lbnF1ZXVlKHtcbiAgICAgICAgICBqb2JOYW1lOiBqb2JDbGFzcy5qb2JOYW1lKCksXG4gICAgICAgICAgYXJncyxcbiAgICAgICAgICBvcHRpb25zOiBqb2JDbGFzcy5fd2l0aEpvYkNvbnRleHQoe2pvYkFyZ3M6IGFyZ3MsIGpvYk9wdGlvbnM6IG9wdGlvbnN9KVxuICAgICAgICB9KVxuICAgICAgICB0aGlzLl9ub3RpZnlFbnF1ZXVlZCgpXG4gICAgICAgIHZvaWQgdGhpcy5fZHJhaW4oKVxuICAgICAgfVxuICAgIH0pXG4gICAgYXdhaXQgdGhpcy5zY2hlZHVsZXIuc3RhcnQoKVxuXG4gICAgY29uc3QgcmV0ZW50aW9uU2NoZWR1bGUgPSBQcnVuZVRlcm1pbmFsQmFja2dyb3VuZEpvYnNKb2Iuc2NoZWR1bGVDb25maWd1cmF0aW9uKHRoaXMucmV0ZW50aW9uKVxuXG4gICAgaWYgKHJldGVudGlvblNjaGVkdWxlKSB7XG4gICAgICB0aGlzLnNjaGVkdWxlci5zY2hlZHVsZUpvYih7am9iQ29uZmlndXJhdGlvbjogcmV0ZW50aW9uU2NoZWR1bGUsIGpvYktleTogXCJ2ZWxvY2lvdXNQcnVuZVRlcm1pbmFsQmFja2dyb3VuZEpvYnNcIn0pXG4gICAgfVxuICB9XG5cbiAgLyoqIENyZWRpdHMgcmVhZGluZXNzIGFkdmVydGlzZW1lbnRzIHJlY29yZGVkIHdoaWxlIGRpc3BhdGNoIHdhcyBmZW5jZWQuICovXG4gIF9jcmVkaXRSZWFkeVdvcmtlcnMoKSB7XG4gICAgZm9yIChjb25zdCB3b3JrZXIgb2YgdGhpcy5jYW5kaWRhdGVSZWFkeVdvcmtlcnMpIHtcbiAgICAgIGlmICh0aGlzLndvcmtlcnMuaGFzKHdvcmtlcikgJiYgIXdvcmtlci5pc0RyYWluaW5nICYmIHdvcmtlci5zdXBwb3J0c0hhbmRvZmZJZFJlcG9ydGluZykge1xuICAgICAgICB0aGlzLnJlYWR5V29ya2Vycy5hZGQod29ya2VyKVxuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLmNhbmRpZGF0ZVJlYWR5V29ya2Vycy5jbGVhcigpXG4gIH1cblxuICAvKipcbiAgICogQWN0aXZhdGVzIGEgY2FuZGlkYXRlIGFmdGVyIGl0cyBzdXBlcnZpc29yIGhhcyByZXRpcmVkIHRoZSBvbGQgZ2VuZXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgc2NoZWR1bGluZyBhbmQgZGlzcGF0Y2ggYXJlIGFjdGl2ZS5cbiAgICovXG4gIGFjdGl2YXRlKCkge1xuICAgIGlmICghdGhpcy5nZW5lcmF0aW9uSWQpIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyBnZW5lcmF0aW9uIGFjdGl2YXRpb24gcmVxdWlyZXMgZ2VuZXJhdGlvbiBtb2RlXCIpXG4gICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwiYWN0aXZlXCIpIHJldHVybiBQcm9taXNlLnJlc29sdmUoKVxuICAgIGlmICh0aGlzLmxpZmVjeWNsZVN0YXRlICE9PSBcImNhbmRpZGF0ZVwiKSB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBhY3RpdmF0ZSBiYWNrZ3JvdW5kIGpvYnMgZ2VuZXJhdGlvbiBmcm9tICR7dGhpcy5saWZlY3ljbGVTdGF0ZX1gKVxuICAgIGlmICghdGhpcy5fYWN0aXZhdGlvblByb21pc2UpIHRoaXMuX2FjdGl2YXRpb25Qcm9taXNlID0gdGhpcy5fYWN0aXZhdGUoKVxuXG4gICAgcmV0dXJuIHRoaXMuX2FjdGl2YXRpb25Qcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhY3RpdmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBBY3RpdmF0aW9uIGNvbXBsZXRpb24uXG4gICAqL1xuICBhc3luYyBfYWN0aXZhdGUoKSB7XG4gICAgdGhpcy5sb2dnZXIuaW5mbygoKSA9PiBbXCJCYWNrZ3JvdW5kIGpvYnMgZ2VuZXJhdGlvbiBhY3RpdmF0aW9uIHN0YXJ0aW5nXCIsIHtnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkfV0pXG4gICAgY29uc3Qgb3duZXJzaGlwU3RhcnRlZCA9IGF3YWl0IHRoaXMuX3N0YXJ0QWN0aXZlT3duZXJzaGlwKFwiY2FuZGlkYXRlXCIpXG4gICAgaWYgKCFvd25lcnNoaXBTdGFydGVkIHx8IHRoaXMubGlmZWN5Y2xlU3RhdGUgIT09IFwiY2FuZGlkYXRlXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyBnZW5lcmF0aW9uIHJldGlyZW1lbnQgc3RhcnRlZCBiZWZvcmUgYWN0aXZhdGlvbiBhY3F1aXJlZCBvd25lcnNoaXBcIilcbiAgICB9XG4gICAgdGhpcy5saWZlY3ljbGVTdGF0ZSA9IFwiYWN0aXZlXCJcbiAgICB0aGlzLl9jcmVkaXRSZWFkeVdvcmtlcnMoKVxuICAgIHRoaXMubG9nZ2VyLmluZm8oKCkgPT4gW1wiQmFja2dyb3VuZCBqb2JzIGdlbmVyYXRpb24gYWN0aXZhdGlvbiBhY2tub3dsZWRnZWRcIiwge2dlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWR9XSlcbiAgICB2b2lkIHRoaXMuX2RyYWluKCkuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJCYWNrZ3JvdW5kIGpvYnMgZ2VuZXJhdGlvbiBwb3N0LWFjdGl2YXRpb24gZHJhaW4gZmFpbGVkXCIsIHtlcnJvciwgZ2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZH1dKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRXN0YWJsaXNoZXMgdGhlIHN5bmNocm9ub3VzIHJldGlyZW1lbnQgZmVuY2UgYW5kIHRoZW4gZHJhaW5zIG93bmVyc2hpcCBzZXR1cC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHJldGlyZW1lbnQgZmVuY2UgaXMgZHVyYWJsZSBpbiBtZW1vcnkuXG4gICAqL1xuICByZXRpcmUoKSB7XG4gICAgaWYgKCF0aGlzLmdlbmVyYXRpb25JZCkgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIGdlbmVyYXRpb24gcmV0aXJlbWVudCByZXF1aXJlcyBnZW5lcmF0aW9uIG1vZGVcIilcbiAgICBpZiAodGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJyZXRpcmluZ1wiIHx8IHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwicmV0aXJlZFwiKSByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKClcbiAgICBjb25zdCBhY3RpdmF0aW9uSW5Qcm9ncmVzcyA9IHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwiY2FuZGlkYXRlXCIgJiYgQm9vbGVhbih0aGlzLl9hY3RpdmF0aW9uUHJvbWlzZSlcbiAgICBpZiAodGhpcy5saWZlY3ljbGVTdGF0ZSAhPT0gXCJhY3RpdmVcIiAmJiAhYWN0aXZhdGlvbkluUHJvZ3Jlc3MpIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IHJldGlyZSBiYWNrZ3JvdW5kIGpvYnMgZ2VuZXJhdGlvbiBmcm9tICR7dGhpcy5saWZlY3ljbGVTdGF0ZX1gKVxuXG4gICAgdGhpcy5saWZlY3ljbGVTdGF0ZSA9IFwicmV0aXJpbmdcIlxuICAgIHRoaXMuX2FjdGl2ZU93bmVyc2hpcFJlYWR5ID0gZmFsc2VcbiAgICB0aGlzLnJlYWR5V29ya2Vycy5jbGVhcigpXG4gICAgdGhpcy5jYW5kaWRhdGVSZWFkeVdvcmtlcnMuY2xlYXIoKVxuICAgIHRoaXMuX2NsZWFyRGlzcGF0Y2hUaW1lcnMoKVxuICAgIHRoaXMuX2Rpc2Nvbm5lY3RCZWFjb25IYW5kbGVycygpXG4gICAgdGhpcy5fcmV0aXJlbWVudFByb21pc2UgPSB0aGlzLl9yZXRpcmUoKVxuICAgIHZvaWQgdGhpcy5fcmV0aXJlbWVudFByb21pc2UuY2F0Y2goKGVycm9yKSA9PiB0aGlzLl9yZXBvcnRDb25uZWN0aW9uSGFuZGxlckVycm9yKGVycm9yKSlcblxuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmV0aXJlbWVudCBhZnRlciBpdHMgc3luY2hyb25vdXMgZmVuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJldGlyZW1lbnQgZmVuY2UgY29tcGxldGlvbi5cbiAgICovXG4gIGFzeW5jIF9yZXRpcmUoKSB7XG4gICAgaWYgKHRoaXMuX2FjdGl2YXRpb25Qcm9taXNlKSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoW3RoaXMuX2FjdGl2YXRpb25Qcm9taXNlXSlcbiAgICBpZiAodGhpcy5zY2hlZHVsZXIpIGF3YWl0IHRoaXMuc2NoZWR1bGVyLnN0b3AoKVxuICAgIHRoaXMuc2NoZWR1bGVyID0gdW5kZWZpbmVkXG4gICAgaWYgKHRoaXMuX2RyYWluUHJvbWlzZSkgYXdhaXQgdGhpcy5fZHJhaW5Qcm9taXNlXG4gICAgaWYgKHRoaXMuX3N0b3BwZWQpIHJldHVyblxuXG4gICAgZm9yIChjb25zdCB3b3JrZXIgb2YgdGhpcy53b3JrZXJzKSB7XG4gICAgICB3b3JrZXIuaXNEcmFpbmluZyA9IHRydWVcbiAgICAgIHdvcmtlci5zZW5kKHt0eXBlOiBcInJldGlyZVwiLCBnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkfSlcbiAgICB9XG5cbiAgICB0aGlzLmxpZmVjeWNsZVN0YXRlID0gXCJyZXRpcmVkXCJcbiAgICB0aGlzLl9zdGFydEdlbmVyYXRpb25SZWNvdmVyeU93bmVyc2hpcCgpXG4gIH1cblxuICAvKiogQ2xlYXJzIHRpbWVycyB0aGF0IGNhbiBpbml0aWF0ZSBuZXcgZ2xvYmFsIGRpc3BhdGNoIG9yIHNjaGVkdWxlIHdvcmsuICovXG4gIF9jbGVhckRpc3BhdGNoVGltZXJzKCkge1xuICAgIGlmICh0aGlzLl9wb2xsVGltZXIpIGNsZWFySW50ZXJ2YWwodGhpcy5fcG9sbFRpbWVyKVxuICAgIGlmICh0aGlzLl9zY2hlZHVsZWRUaW1lcikgdGhpcy5jbG9jay5jbGVhclRpbWVvdXQodGhpcy5fc2NoZWR1bGVkVGltZXIpXG4gICAgaWYgKHRoaXMuX2Vycm9yUmV0cnlUaW1lcikgY2xlYXJUaW1lb3V0KHRoaXMuX2Vycm9yUmV0cnlUaW1lcilcbiAgICB0aGlzLl9wb2xsVGltZXIgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9zY2hlZHVsZWRUaW1lciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2Vycm9yUmV0cnlUaW1lciA9IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqIEhvbGRzIHRoZSBtYWluIG9wZW4gdW50aWwgYSBsaWZlY3ljbGUgcmVzcG9uc2UgaGFzIGZsdXNoZWQuICovXG4gIGFjcXVpcmVMaWZlY3ljbGVSZXF1ZXN0TGVhc2UoKSB7IHRoaXMuX2xpZmVjeWNsZVJlcXVlc3RMZWFzZXMgKz0gMSB9XG5cbiAgLyoqIFJlbGVhc2VzIG9uZSBsaWZlY3ljbGUtcmVzcG9uc2UgbGVhc2UgYWZ0ZXIgaXRzIHNvY2tldCB3cml0ZSBjYWxsYmFjay4gKi9cbiAgcmVsZWFzZUxpZmVjeWNsZVJlcXVlc3RMZWFzZSgpIHtcbiAgICBpZiAodGhpcy5fbGlmZWN5Y2xlUmVxdWVzdExlYXNlcyA8IDEpIHRocm93IG5ldyBFcnJvcihcIk5vIGJhY2tncm91bmQgam9icyBsaWZlY3ljbGUgcmVxdWVzdCBsZWFzZSB0byByZWxlYXNlXCIpXG4gICAgdGhpcy5fbGlmZWN5Y2xlUmVxdWVzdExlYXNlcyAtPSAxXG4gICAgdGhpcy5fbWF5YmVTdG9wUmV0aXJlZCgpXG4gIH1cblxuICAvKiogU3RvcHMgYSByZXRpcmVkIGdlbmVyYXRpb24gb25seSBhZnRlciBpdHMgZXhhY3Qgb3duZXJzaGlwIGhhcyBkcmFpbmVkLiAqL1xuICBfbWF5YmVTdG9wUmV0aXJlZCgpIHtcbiAgICBpZiAodGhpcy5saWZlY3ljbGVTdGF0ZSAhPT0gXCJyZXRpcmVkXCIgfHwgdGhpcy5fc3RvcHBlZCB8fCB0aGlzLnN0b3BQcm9taXNlKSByZXR1cm5cbiAgICBpZiAodGhpcy5fbGlmZWN5Y2xlUmVxdWVzdExlYXNlcyA+IDAgfHwgdGhpcy5fYWN0aXZlTm9uV29ya2VyUmVxdWVzdHMgPiAwIHx8IHRoaXMud29ya2Vycy5zaXplID4gMCB8fCB0aGlzLmRpc2Nvbm5lY3RlZFdvcmtlcnMuc2l6ZSA+IDApIHJldHVyblxuICAgIGlmICh0aGlzLmluZmxpZ2h0V29ya2VySGFuZG9mZkFkb3B0aW9ucy5zaXplID4gMCB8fCB0aGlzLnBlbmRpbmdIYW5kb2ZmUmVjb3Zlcmllcy5zaXplID4gMCkgcmV0dXJuXG4gICAgaWYgKHRoaXMuX2RyYWluUHJvbWlzZSB8fCB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1Qcm9taXNlIHx8IHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVRpbWVyKSByZXR1cm5cbiAgICBpZiAodGhpcy5zdGFydHVwSGFuZG9mZlNuYXBzaG90Lmxlbmd0aCA+IDApIHJldHVyblxuXG4gICAgZm9yIChjb25zdCBoYW5kb2ZmcyBvZiB0aGlzLndvcmtlckhhbmRvZmZzLnZhbHVlcygpKSB7XG4gICAgICBpZiAoaGFuZG9mZnMuc2l6ZSA+IDApIHJldHVyblxuICAgIH1cblxuICAgIHZvaWQgdGhpcy5zdG9wKCkuY2F0Y2goKGVycm9yKSA9PiB0aGlzLl9yZXBvcnRDb25uZWN0aW9uSGFuZGxlckVycm9yKGVycm9yKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBXaXJlcyB1cCB0aGUgZGlzcGF0Y2gtdHJpZ2dlcmluZyBzaWduYWwgc291cmNlcyBmb3IgdGhlIGNvbmZpZ3VyZWRcbiAgICogc3RyYXRlZ3kuIEluIGBcImJlYWNvblwiYCBtb2RlIChkZWZhdWx0KSB0aGlzIG1lYW5zIHN1YnNjcmliaW5nIHRvIHRoZVxuICAgKiBgdmVsb2Npb3VzLWJhY2tncm91bmQtam9icy1kaXNwYXRjaGAgY2hhbm5lbCBmb3IgY3Jvc3MtcHJvY2Vzc1xuICAgKiB3YWtlLXVwcywgbGlzdGVuaW5nIGZvciBCZWFjb24gKHJlKWNvbm5lY3RzIHRvIGNhdGNoIHVwIG9uIG1pc3NlZFxuICAgKiB3b3JrLCBhbmQgcmVseWluZyBvbiBkaXJlY3QgaW4tcHJvY2VzcyBjYWxscyBmcm9tIGBfaGFuZGxlRW5xdWV1ZWAsXG4gICAqIGBfaGFuZGxlSm9iQ29tcGxldGVgL2BGYWlsZWRgLCB3b3JrZXIgaGVsbG8vcmVhZHksIGFuZCB0aGVcbiAgICogc2NoZWR1bGVkLWpvYiBgc2V0VGltZW91dGAuIEluIGBcInBvbGxpbmdcImAgbW9kZSB3ZSByZXN0b3JlIHRoZVxuICAgKiBsZWdhY3kgZml4ZWQtaW50ZXJ2YWwgcG9sbCBmb3IgdXNlcnMgd2hvIHdhbnQgdGhlIHByZXZpb3VzIGJlaGF2aW9yLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zZXR1cERpc3BhdGNoVHJpZ2dlcnMoKSB7XG4gICAgaWYgKHRoaXMuZGlzcGF0Y2hTdHJhdGVneSA9PT0gXCJwb2xsaW5nXCIpIHtcbiAgICAgIHRoaXMuX3BvbGxUaW1lciA9IHNldEludGVydmFsKCgpID0+IHtcbiAgICAgICAgdm9pZCB0aGlzLl9yZXRyeUFmdGVyRXJyb3IoKVxuICAgICAgfSwgdGhpcy5wb2xsSW50ZXJ2YWxNcylcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IGJlYWNvbkNsaWVudCA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCZWFjb25DbGllbnQoKVxuICAgIGlmICghYmVhY29uQ2xpZW50KSByZXR1cm5cblxuICAgIHRoaXMuX2JlYWNvbkNsaWVudCA9IGJlYWNvbkNsaWVudFxuXG4gICAgdGhpcy5fdW5zdWJzY3JpYmVCZWFjb24gPSBiZWFjb25DbGllbnQub25Ccm9hZGNhc3QoKG1lc3NhZ2UpID0+IHtcbiAgICAgIGlmIChtZXNzYWdlPy5jaGFubmVsICE9PSBESVNQQVRDSF9DSEFOTkVMKSByZXR1cm5cbiAgICAgIHZvaWQgdGhpcy5fZHJhaW4oKVxuICAgIH0pXG5cbiAgICAvLyBEcmFpbiBvbiBldmVyeSAocmUpY29ubmVjdCB0byBjYXRjaCB1cCBvbiBqb2JzIGVucXVldWVkIHdoaWxlIHRoZVxuICAgIC8vIGJ1cyB3YXMgdW5yZWFjaGFibGUuIFRoZSBEQiBpcyB0aGUgZHVyYWJsZSBsb2c7IEJlYWNvbiBpcyBqdXN0IHRoZVxuICAgIC8vIHdha2UtdXAgc2lnbmFsLlxuICAgIHRoaXMuX2JlYWNvbkNvbm5lY3RIYW5kbGVyID0gKCkgPT4ge1xuICAgICAgdm9pZCB0aGlzLl9kcmFpbigpXG4gICAgfVxuICAgIGJlYWNvbkNsaWVudC5vbihcImNvbm5lY3RcIiwgdGhpcy5fYmVhY29uQ29ubmVjdEhhbmRsZXIpXG4gIH1cblxuICAvKipcbiAgICogQXJtcyB0aGUgYm91bmRlZCBhZG9wdGlvbiBncmFjZSBvbmx5IHdoZW4gc3RhcnR1cCBmb3VuZCBleGFjdCBwZXJzaXN0ZWRcbiAgICogaGFuZG9mZnMuIFRoZSB0aW1lciBpcyB1bnJlZmVkIHNvIGFuIG90aGVyd2lzZS1maW5pc2hlZCBwcm9jZXNzIGlzIG5ldmVyXG4gICAqIHJldGFpbmVkIHNvbGVseSB0byBwZXJmb3JtIHRoaXMgY2xlYW51cC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2V0dXBTdGFydHVwSGFuZG9mZlJlY2xhaW0oKSB7XG4gICAgaWYgKHRoaXMuc3RhcnR1cEhhbmRvZmZTbmFwc2hvdC5sZW5ndGggPT09IDApIHJldHVyblxuICAgIGlmICh0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1UaW1lciB8fCB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1Qcm9taXNlIHx8IHRoaXMuX3N0YXJ0dXBIYW5kb2ZmR3JhY2VFbGFwc2VkKSByZXR1cm5cblxuICAgIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVRpbWVyID0gdGhpcy5jbG9jay5zZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVRpbWVyID0gdW5kZWZpbmVkXG4gICAgICB0aGlzLl9zdGFydHVwSGFuZG9mZkFkb3B0aW9uc0F0RGVhZGxpbmUgPSBbLi4udGhpcy5pbmZsaWdodFdvcmtlckhhbmRvZmZBZG9wdGlvbnNdXG4gICAgICB0aGlzLl9zdGFydHVwSGFuZG9mZkdyYWNlRWxhcHNlZCA9IHRydWVcbiAgICAgIHZvaWQgdGhpcy5fc3RhcnRTdGFydHVwSGFuZG9mZlJlY2xhaW0oKVxuICAgIH0sIHRoaXMud29ya2VyUmVjb25uZWN0R3JhY2VNcylcbiAgICBpZiAodHlwZW9mIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVRpbWVyID09PSBcIm9iamVjdFwiKSB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1UaW1lci51bnJlZigpXG4gIH1cblxuICAvKipcbiAgICogU3RhcnRzIG9uZSB0cmFja2VkIHN0YXJ0dXAtcmVjbGFpbSBwYXNzLCBjb2FsZXNjaW5nIGxpZmVjeWNsZSBhbmQgcmV0cnlcbiAgICogY2FsbGVycyBzbyBzaHV0ZG93biBjYW4gd2FpdCBmb3IgZHVyYWJsZSBtdXRhdGlvbiBiZWZvcmUgY2xvc2luZyBwb29scy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhpcyBwYXNzIHNldHRsZXMuXG4gICAqL1xuICBfc3RhcnRTdGFydHVwSGFuZG9mZlJlY2xhaW0oKSB7XG4gICAgaWYgKHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVByb21pc2UpIHJldHVybiB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1Qcm9taXNlXG5cbiAgICBjb25zdCByZWNsYWltID0gdGhpcy5fcmVjbGFpbURpc2Nvbm5lY3RlZFN0YXJ0dXBIYW5kb2ZmcygpXG5cbiAgICB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1Qcm9taXNlID0gcmVjbGFpbVxuICAgIGNvbnN0IGNsZWFyUmVjbGFpbSA9ICgpID0+IHtcbiAgICAgIGlmICh0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1Qcm9taXNlID09PSByZWNsYWltKSB7XG4gICAgICAgIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVByb21pc2UgPSB1bmRlZmluZWRcbiAgICAgIH1cbiAgICB9XG4gICAgdm9pZCByZWNsYWltLnRoZW4oY2xlYXJSZWNsYWltLCBjbGVhclJlY2xhaW0pXG5cbiAgICByZXR1cm4gcmVjbGFpbVxuICB9XG5cbiAgLyoqXG4gICAqIFdhaXRzIGZvciBhbiBhbHJlYWR5LXN0YXJ0ZWQgc3RhcnR1cCByZWNsYWltIGJlZm9yZSBhZGFwdGVyIHNodXRkb3duLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIG5vIHBhc3MgcmVtYWlucy5cbiAgICovXG4gIGFzeW5jIF9kcmFpblN0YXJ0dXBIYW5kb2ZmUmVjbGFpbSgpIHtcbiAgICB3aGlsZSAodGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltUHJvbWlzZSkge1xuICAgICAgYXdhaXQgdGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltUHJvbWlzZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBPcnBoYW5zIG9ubHkgc3RhcnR1cC1zbmFwc2hvdHRlZCBsZWFzZXMgd2hvc2Ugc3RhYmxlIHdvcmtlciBpZCBoYXMgbm90IGJlZW5cbiAgICogb2JzZXJ2ZWQgYnkgdGhpcyBtYWluIGdlbmVyYXRpb24uIFN0b3JlIGZlbmNpbmcgcmVqZWN0cyBjb21wbGV0ZWQsXG4gICAqIHJldHVybmVkLCByZXBsYWNlZCwgYW5kIHJlLWhhbmRlZC1vZmYgcm93cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcmVjbGFpbSBvciByZXRhaW5lZCByZXRyeSBzdGF0ZS5cbiAgICovXG4gIGFzeW5jIF9yZWNsYWltRGlzY29ubmVjdGVkU3RhcnR1cEhhbmRvZmZzKCkge1xuICAgIGlmICh0aGlzLl9zdG9wcGVkIHx8ICF0aGlzLl9zdGFydHVwSGFuZG9mZkdyYWNlRWxhcHNlZCkgcmV0dXJuXG4gICAgaWYgKHRoaXMuc3RhcnR1cEhhbmRvZmZTbmFwc2hvdC5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgYXdhaXQgdGhpcy5fd2FpdEZvclN0YXJ0dXBIYW5kb2ZmQWRvcHRpb25zQXREZWFkbGluZSgpXG4gICAgaWYgKHRoaXMuX3N0b3BwZWQpIHJldHVyblxuXG4gICAgY29uc3QgaGFuZG9mZnMgPSB0aGlzLnN0YXJ0dXBIYW5kb2ZmU25hcHNob3QuZmlsdGVyKCh7d29ya2VySWR9KSA9PiAhdGhpcy5yZWNvbm5lY3RlZFdvcmtlcklkcy5oYXMod29ya2VySWQpKVxuXG4gICAgaWYgKGhhbmRvZmZzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhpcy5zdGFydHVwSGFuZG9mZlNuYXBzaG90ID0gW11cbiAgICAgIHRoaXMuX21heWJlU3RvcFJldGlyZWQoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgbGV0IG9ycGhhbmVkSm9ic1xuXG4gICAgdHJ5IHtcbiAgICAgIG9ycGhhbmVkSm9icyA9IGF3YWl0IHRoaXMuc3RvcmUubWFya09ycGhhbmVkSGFuZG9mZnMoe1xuICAgICAgICBlcnJvcjogXCJKb2Igb3JwaGFuZWQgYWZ0ZXIgaXRzIHByZS1yZXN0YXJ0IHdvcmtlciBkaWQgbm90IHJlY29ubmVjdFwiLFxuICAgICAgICBoYW5kb2Zmc1xuICAgICAgfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5fcmVwb3J0U3RhcnR1cEhhbmRvZmZSZWNsYWltRXJyb3IoZXJyb3IpXG4gICAgICB0aGlzLl9zY2hlZHVsZUVycm9yUmV0cnkoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5zdGFydHVwSGFuZG9mZlNuYXBzaG90ID0gW11cbiAgICBhd2FpdCB0aGlzLl9oYW5kbGVPcnBoYW5lZEpvYnMoe1xuICAgICAgam9iczogb3JwaGFuZWRKb2JzLFxuICAgICAgd2FybmluZzogXCJSZWNsYWltZWQgYmFja2dyb3VuZCBqb2JzIGZyb20gd29ya2VycyBhYnNlbnQgYWZ0ZXIgbWFpbiByZXN0YXJ0IGdyYWNlXCJcbiAgICB9KVxuICAgIHRoaXMub25TdGFydHVwSGFuZG9mZnNSZWNsYWltZWQ/LihvcnBoYW5lZEpvYnMpXG4gICAgdGhpcy5fbWF5YmVTdG9wUmV0aXJlZCgpXG4gIH1cblxuICAvKipcbiAgICogTGV0cyBhZG9wdGlvbiBxdWVyaWVzIGFscmVhZHkgcnVubmluZyBhdCB0aGUgcmVjb25uZWN0IGRlYWRsaW5lIHNldHRsZVxuICAgKiBiZWZvcmUgd29ya2VyIGlkcyBhcmUgZmlsdGVyZWQuIEEgc2Vjb25kIGJvdW5kZWQgZ3JhY2UgcHJldmVudHMgYSBzdHVja1xuICAgKiBhZGFwdGVyIHF1ZXJ5IGZyb20gZGVmZXJyaW5nIHN0YXJ0dXAgcmVjbGFpbSBmb3JldmVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBkZWFkbGluZSBzZXQgc2V0dGxlcyBvciB0aW1lcyBvdXQuXG4gICAqL1xuICBhc3luYyBfd2FpdEZvclN0YXJ0dXBIYW5kb2ZmQWRvcHRpb25zQXREZWFkbGluZSgpIHtcbiAgICBjb25zdCBhZG9wdGlvbnMgPSB0aGlzLl9zdGFydHVwSGFuZG9mZkFkb3B0aW9uc0F0RGVhZGxpbmVcblxuICAgIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmQWRvcHRpb25zQXREZWFkbGluZSA9IFtdXG4gICAgaWYgKGFkb3B0aW9ucy5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IHVuZGVmaW5lZH0gKi9cbiAgICBsZXQgdGltZXJcbiAgICBjb25zdCB3YWl0TGltaXQgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgLy8gVGhpcyBsaWZlY3ljbGUgZGVhZGxpbmUgbXVzdCBub3Qga2VlcCB0aGUgbWFpbiBwcm9jZXNzIGFsaXZlOyB0aGVcbiAgICAgIC8vIGdlbmVyaWMgdGltZW91dCBoZWxwZXIgaW50ZW50aW9uYWxseSB1c2VzIGEgcmVmZXJlbmNlZCB0aW1lci5cbiAgICAgIHRpbWVyID0gc2V0VGltZW91dChyZXNvbHZlLCB0aGlzLndvcmtlclJlY29ubmVjdEdyYWNlTXMpXG4gICAgICB0aW1lci51bnJlZigpXG4gICAgfSlcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBQcm9taXNlLnJhY2UoW1Byb21pc2UuYWxsKGFkb3B0aW9ucyksIHdhaXRMaW1pdF0pXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmICh0aW1lcikgY2xlYXJUaW1lb3V0KHRpbWVyKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQdWJsaXNoZXMgYSBkaXNwYXRjaCB3YWtlLXVwIG9uIHRoZSBCZWFjb24gY2hhbm5lbC4gTm8tb3AgaW4gcG9sbGluZ1xuICAgKiBtb2RlIG9yIHdoZW4gQmVhY29uIGlzIG5vdCBjb25uZWN0ZWQ7IGluIHRob3NlIGNhc2VzIHRoZSBkaXJlY3RcbiAgICogaW4tcHJvY2VzcyBgX2RyYWluKClgIGNhbGwgaW4gdGhlIGVucXVldWUvaGFuZGxlIHBhdGhzIGlzIHN1ZmZpY2llbnRcbiAgICogKHRoZXJlIGFyZSBubyBvdGhlciBwcm9jZXNzZXMgdG8gbm90aWZ5KS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfbm90aWZ5RW5xdWV1ZWQoKSB7XG4gICAgaWYgKHRoaXMuZGlzcGF0Y2hTdHJhdGVneSA9PT0gXCJwb2xsaW5nXCIpIHJldHVyblxuXG4gICAgY29uc3QgYmVhY29uQ2xpZW50ID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEJlYWNvbkNsaWVudCgpXG4gICAgaWYgKCFiZWFjb25DbGllbnQgfHwgIWJlYWNvbkNsaWVudC5pc0Nvbm5lY3RlZCgpKSByZXR1cm5cblxuICAgIHRyeSB7XG4gICAgICBiZWFjb25DbGllbnQucHVibGlzaCh7XG4gICAgICAgIGNoYW5uZWw6IERJU1BBVENIX0NIQU5ORUwsXG4gICAgICAgIGJyb2FkY2FzdFBhcmFtczoge30sXG4gICAgICAgIGJvZHk6IHthY3Rpb246IFwid2FrZVwifVxuICAgICAgfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5sb2dnZXIud2FybigoKSA9PiBbXCJGYWlsZWQgdG8gcHVibGlzaCBiYWNrZ3JvdW5kIGpvYnMgd2FrZSBicm9hZGNhc3Q6XCIsIGVycm9yXSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJuZXRcIikuU29ja2V0fSBzb2NrZXQgLSBTb2NrZXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2hhbmRsZUNvbm5lY3Rpb24oc29ja2V0KSB7XG4gICAgY29uc3QganNvblNvY2tldCA9IG5ldyBKc29uU29ja2V0KHNvY2tldClcbiAgICB0aGlzLmNvbm5lY3Rpb25zLmFkZChqc29uU29ja2V0KVxuICAgIC8qKlxuICAgICAqIFJvbGUuXG4gICAgICogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNvY2tldFJvbGUgfCBudWxsfSAqL1xuICAgIGxldCByb2xlID0gbnVsbFxuXG4gICAgbGV0IGNsZWFuZWRVcCA9IGZhbHNlXG4gICAgY29uc3QgY2xlYW51cCA9ICgpID0+IHtcbiAgICAgIGlmIChjbGVhbmVkVXApIHJldHVyblxuICAgICAgY2xlYW5lZFVwID0gdHJ1ZVxuICAgICAgdGhpcy5jb25uZWN0aW9ucy5kZWxldGUoanNvblNvY2tldClcblxuICAgICAgaWYgKHJvbGUgPT09IFwid29ya2VyXCIpIHZvaWQgdGhpcy5faGFuZGxlV29ya2VyU29ja2V0Q2xvc2VkKGpzb25Tb2NrZXQpXG4gICAgICB0aGlzLl9tYXliZVN0b3BSZXRpcmVkKClcbiAgICB9XG5cbiAgICBqc29uU29ja2V0Lm9uKFwiY2xvc2VcIiwgY2xlYW51cClcbiAgICBqc29uU29ja2V0Lm9uKFwiZXJyb3JcIiwgKGVycm9yKSA9PiB7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKCgpID0+IFtcIkJhY2tncm91bmQgam9icyBjb25uZWN0aW9uIGVycm9yOlwiLCBlcnJvcl0pXG4gICAgICBjbGVhbnVwKClcbiAgICB9KVxuXG4gICAgbGV0IG1lc3NhZ2VIYW5kbGluZyA9IFByb21pc2UucmVzb2x2ZSgpXG4gICAganNvblNvY2tldC5vbihcIm1lc3NhZ2VcIiwgKG1lc3NhZ2UpID0+IHtcbiAgICAgIG1lc3NhZ2VIYW5kbGluZyA9IG1lc3NhZ2VIYW5kbGluZy50aGVuKGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgZXhpc3RpbmdSb2xlID0gcm9sZVxuICAgICAgICByb2xlID0gYXdhaXQgdGhpcy5faGFuZGxlU29ja2V0TWVzc2FnZSh7anNvblNvY2tldCwgbWVzc2FnZSwgcm9sZX0pXG4gICAgICAgIGlmIChleGlzdGluZ1JvbGUgPT09IFwiY2xpZW50XCIgfHwgZXhpc3RpbmdSb2xlID09PSBcInJlcG9ydGVyXCIpIGpzb25Tb2NrZXQuY2xvc2UoKVxuICAgICAgfSkuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICAgIHRoaXMuX3JlcG9ydENvbm5lY3Rpb25IYW5kbGVyRXJyb3IoZXJyb3IpXG4gICAgICAgIGpzb25Tb2NrZXQuY2xvc2UoKVxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFN1cmZhY2VzIGFuIHVuZXhwZWN0ZWQgcHJvdG9jb2wtaGFuZGxlciBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBlcnJvciAtIEhhbmRsZXIgZmFpbHVyZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVwb3J0Q29ubmVjdGlvbkhhbmRsZXJFcnJvcihlcnJvcikge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKVxuICAgIGNvbnN0IHBheWxvYWQgPSB7Y29udGV4dDoge3N0YWdlOiBcImJhY2tncm91bmQtam9icy1zb2NrZXQtaGFuZGxlclwifSwgZXJyb3I6IG5vcm1hbGl6ZWRFcnJvcn1cbiAgICBjb25zdCBlcnJvckV2ZW50cyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpXG5cbiAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJCYWNrZ3JvdW5kIGpvYnMgc29ja2V0IGhhbmRsZXIgZmFpbGVkOlwiLCBub3JtYWxpemVkRXJyb3JdKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIHNvY2tldCBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy5qc29uU29ja2V0IC0gSlNPTiBzb2NrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU29ja2V0TWVzc2FnZX0gYXJncy5tZXNzYWdlIC0gU29ja2V0IG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU29ja2V0Um9sZSB8IG51bGx9IGFyZ3Mucm9sZSAtIEN1cnJlbnQgc29ja2V0IHJvbGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNvY2tldFJvbGUgfCBudWxsPn0gLSBVcGRhdGVkIHNvY2tldCByb2xlLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZVNvY2tldE1lc3NhZ2Uoe2pzb25Tb2NrZXQsIG1lc3NhZ2UsIHJvbGV9KSB7XG4gICAgaWYgKCFyb2xlKSByZXR1cm4gYXdhaXQgdGhpcy5faGFuZGxlUm9sZWxlc3NTb2NrZXRNZXNzYWdlKHtqc29uU29ja2V0LCBtZXNzYWdlfSlcbiAgICBpZiAocm9sZSA9PT0gXCJ3b3JrZXJcIikge1xuICAgICAgYXdhaXQgdGhpcy5faGFuZGxlV29ya2VyU29ja2V0TWVzc2FnZSh7anNvblNvY2tldCwgbWVzc2FnZX0pXG4gICAgICByZXR1cm4gcm9sZVxuICAgIH1cblxuICAgIHRoaXMuX2FjdGl2ZU5vbldvcmtlclJlcXVlc3RzICs9IDFcbiAgICB0cnkge1xuICAgICAgaWYgKHJvbGUgPT09IFwiY2xpZW50XCIpIGF3YWl0IHRoaXMuX2hhbmRsZUNsaWVudFNvY2tldE1lc3NhZ2Uoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KVxuICAgICAgaWYgKHJvbGUgPT09IFwicmVwb3J0ZXJcIikgYXdhaXQgdGhpcy5faGFuZGxlUmVwb3J0ZXJTb2NrZXRNZXNzYWdlKHtqc29uU29ja2V0LCBtZXNzYWdlfSlcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5fYWN0aXZlTm9uV29ya2VyUmVxdWVzdHMgLT0gMVxuICAgICAgdGhpcy5fbWF5YmVTdG9wUmV0aXJlZCgpXG4gICAgfVxuXG4gICAgcmV0dXJuIHJvbGVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSByb2xlbGVzcyBzb2NrZXQgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNvY2tldE1lc3NhZ2V9IGFyZ3MubWVzc2FnZSAtIFNvY2tldCBtZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTb2NrZXRSb2xlIHwgbnVsbD59IC0gTmV3IHNvY2tldCByb2xlLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZVJvbGVsZXNzU29ja2V0TWVzc2FnZSh7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICBpZiAobWVzc2FnZT8udHlwZSAhPT0gXCJoZWxsb1wiKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgcmVqZWN0aW9uUmVhc29uID0gdGhpcy5fZ2VuZXJhdGlvbkhlbGxvUmVqZWN0aW9uUmVhc29uKG1lc3NhZ2UpXG5cbiAgICBpZiAocmVqZWN0aW9uUmVhc29uKSB7XG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiZ2VuZXJhdGlvbi1yZWplY3RlZFwiLCByZWFzb246IHJlamVjdGlvblJlYXNvbn0pXG4gICAgICBqc29uU29ja2V0LmNsb3NlKClcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuXG4gICAgaWYgKG1lc3NhZ2Uucm9sZSA9PT0gXCJ3b3JrZXJcIikge1xuICAgICAgaWYgKHRoaXMuX3N0b3BwZWQpIHtcbiAgICAgICAganNvblNvY2tldC5jbG9zZSgpXG4gICAgICAgIHJldHVybiBtZXNzYWdlLnJvbGVcbiAgICAgIH1cblxuICAgICAgaWYgKCEoYXdhaXQgdGhpcy5fcmVnaXN0ZXJXb3JrZXIoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KSkpIHJldHVybiBudWxsXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkKSB7XG4gICAgICBqc29uU29ja2V0LnNlbmQoe1xuICAgICAgICB0eXBlOiBcImdlbmVyYXRpb24tYWNjZXB0ZWRcIixcbiAgICAgICAgZ2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZCxcbiAgICAgICAgbGlmZWN5Y2xlU3RhdGU6IHRoaXMubGlmZWN5Y2xlU3RhdGVcbiAgICAgIH0pXG4gICAgICBpZiAobWVzc2FnZS5yb2xlID09PSBcIndvcmtlclwiICYmICh0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcInJldGlyaW5nXCIgfHwgdGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJyZXRpcmVkXCIpKSB7XG4gICAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJyZXRpcmVcIiwgZ2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZH0pXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG1lc3NhZ2Uucm9sZVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyB0aGUgZ2VuZXJhdGlvbiBmZW5jZSBiZWZvcmUgYXNzaWduaW5nIGEgc29ja2V0IHJvbGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGVsbG9NZXNzYWdlfSBtZXNzYWdlIC0gSGVsbG8gbWVzc2FnZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uUmVqZWN0aW9uUmVhc29uIHwgbnVsbH0gLSBSZWplY3Rpb24gcmVhc29uLlxuICAgKi9cbiAgX2dlbmVyYXRpb25IZWxsb1JlamVjdGlvblJlYXNvbihtZXNzYWdlKSB7XG4gICAgY29uc3QgbWVzc2FnZUhhc0dlbmVyYXRpb24gPSBPYmplY3QuaGFzT3duKG1lc3NhZ2UsIFwiZ2VuZXJhdGlvbklkXCIpXG5cbiAgICBpZiAoIXRoaXMuZ2VuZXJhdGlvbklkKSByZXR1cm4gbWVzc2FnZUhhc0dlbmVyYXRpb24gPyBcInVuZXhwZWN0ZWQtZ2VuZXJhdGlvblwiIDogbnVsbFxuICAgIGlmICghbWVzc2FnZUhhc0dlbmVyYXRpb24pIHJldHVybiBcIm1pc3NpbmctZ2VuZXJhdGlvblwiXG5cbiAgICB0cnkge1xuICAgICAgdmFsaWRhdGVHZW5lcmF0aW9uSWQobWVzc2FnZS5nZW5lcmF0aW9uSWQsIFwiaGVsbG8gZ2VuZXJhdGlvbklkXCIpXG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gXCJtYWxmb3JtZWQtZ2VuZXJhdGlvblwiXG4gICAgfVxuXG4gICAgaWYgKG1lc3NhZ2UuZ2VuZXJhdGlvbklkICE9PSB0aGlzLmdlbmVyYXRpb25JZCkgcmV0dXJuIFwiZ2VuZXJhdGlvbi1taXNtYXRjaFwiXG4gICAgaWYgKG1lc3NhZ2Uucm9sZSA9PT0gXCJ3b3JrZXJcIiAmJiAhd29ya2VySWRCZWxvbmdzVG9HZW5lcmF0aW9uKHtnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkLCB3b3JrZXJJZDogbWVzc2FnZS53b3JrZXJJZH0pKSB7XG4gICAgICByZXR1cm4gXCJnZW5lcmF0aW9uLW1pc21hdGNoXCJcbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIGdlbmVyYXRpb24tZmVuY2VkIHdvcmtlciBhbmQgdHJhbnNmZXJzIG9ubHkgaXRzIGV4YWN0IG93bmVyc2hpcC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBXb3JrZXIgaGVsbG8uXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy5qc29uU29ja2V0IC0gTmV3IHNvY2tldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JIZWxsb01lc3NhZ2V9IGFyZ3MubWVzc2FnZSAtIEhlbGxvLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSB3b3JrZXIgd2FzIGFkbWl0dGVkLlxuICAgKi9cbiAgYXN5bmMgX3JlZ2lzdGVyV29ya2VyKHtqc29uU29ja2V0LCBtZXNzYWdlfSkge1xuICAgIGpzb25Tb2NrZXQud29ya2VySWQgPSBtZXNzYWdlLndvcmtlcklkXG4gICAganNvblNvY2tldC5zdXBwb3J0c0hhbmRvZmZJZFJlcG9ydGluZyA9IG1lc3NhZ2Uuc3VwcG9ydHNIYW5kb2ZmSWRSZXBvcnRpbmcgPT09IHRydWVcbiAgICBqc29uU29ja2V0LnN1cHBvcnRzSGVhcnRiZWF0ID0gbWVzc2FnZS5zdXBwb3J0c0hlYXJ0YmVhdCA9PT0gdHJ1ZVxuICAgIGpzb25Tb2NrZXQubGFzdFNlZW5BdCA9IHRoaXMuY2xvY2subm93KClcblxuICAgIGNvbnN0IHdvcmtlcklkID0ganNvblNvY2tldC53b3JrZXJJZFxuICAgIGNvbnN0IGRpc2Nvbm5lY3RlZCA9IHdvcmtlcklkID8gdGhpcy5kaXNjb25uZWN0ZWRXb3JrZXJzLmdldCh3b3JrZXJJZCkgOiB1bmRlZmluZWRcbiAgICBsZXQgaGFuZG9mZnMgPSBkaXNjb25uZWN0ZWQgPyB0aGlzLndvcmtlckhhbmRvZmZzLmdldChkaXNjb25uZWN0ZWQud29ya2VyKSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IHJlY292ZXJ5T25seSA9IHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwicmV0aXJpbmdcIiB8fCB0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcInJldGlyZWRcIlxuXG4gICAgaWYgKHJlY292ZXJ5T25seSAmJiAoIWhhbmRvZmZzIHx8IGhhbmRvZmZzLnNpemUgPT09IDApKSB7XG4gICAgICBpZiAoIXdvcmtlcklkKSByZXR1cm4gZmFsc2VcbiAgICAgIGNvbnN0IGR1cmFibGVIYW5kb2ZmcyA9IGF3YWl0IHRoaXMuc3RvcmUuaGFuZGVkT2ZmSm9ic0Zvcldvcmtlcih7d29ya2VySWR9KVxuXG4gICAgICBpZiAoZHVyYWJsZUhhbmRvZmZzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiZ2VuZXJhdGlvbi1yZWplY3RlZFwiLCByZWFzb246IFwid29ya2VyLWhhcy1uby1yZWNvdmVyYWJsZS1oYW5kb2Zmc1wifSlcbiAgICAgICAganNvblNvY2tldC5jbG9zZSgpXG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgfVxuXG4gICAgICBoYW5kb2ZmcyA9IG5ldyBNYXAoZHVyYWJsZUhhbmRvZmZzLm1hcCgoe2pvYklkLCBoYW5kb2ZmSWR9KSA9PiBbam9iSWQsIGhhbmRvZmZJZF0pKVxuICAgICAgdGhpcy5yZWNvbm5lY3RlZFdvcmtlcklkcy5hZGQod29ya2VySWQpXG4gICAgfVxuXG4gICAgaWYgKGRpc2Nvbm5lY3RlZCkge1xuICAgICAgdGhpcy5jbG9jay5jbGVhclRpbWVvdXQoZGlzY29ubmVjdGVkLnRpbWVyKVxuICAgICAgaWYgKHdvcmtlcklkKSB0aGlzLmRpc2Nvbm5lY3RlZFdvcmtlcnMuZGVsZXRlKHdvcmtlcklkKVxuICAgICAgdGhpcy53b3JrZXJIYW5kb2Zmcy5kZWxldGUoZGlzY29ubmVjdGVkLndvcmtlcilcbiAgICB9XG5cbiAgICB0aGlzLndvcmtlcnMuYWRkKGpzb25Tb2NrZXQpXG4gICAgdGhpcy53b3JrZXJIYW5kb2Zmcy5zZXQoanNvblNvY2tldCwgaGFuZG9mZnMgfHwgbmV3IE1hcCgpKVxuICAgIGlmIChyZWNvdmVyeU9ubHkpIGpzb25Tb2NrZXQuaXNEcmFpbmluZyA9IHRydWVcbiAgICBpZiAoIWhhbmRvZmZzICYmIHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwiYWN0aXZlXCIpIHRoaXMuX3RyYWNrV29ya2VySGFuZG9mZkFkb3B0aW9uKGpzb25Tb2NrZXQpXG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFRyYWNrcyBhIHdvcmtlciBoYW5kb2ZmLWFkb3B0aW9uIHF1ZXJ5IHRocm91Z2ggc2h1dGRvd24uXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0ganNvblNvY2tldCAtIFJlY29ubmVjdGluZyB3b3JrZXIgc29ja2V0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF90cmFja1dvcmtlckhhbmRvZmZBZG9wdGlvbihqc29uU29ja2V0KSB7XG4gICAgY29uc3QgYWRvcHRpb24gPSB0aGlzLl9hZG9wdFdvcmtlckhhbmRvZmZzKGpzb25Tb2NrZXQpXG4gICAgdGhpcy5pbmZsaWdodFdvcmtlckhhbmRvZmZBZG9wdGlvbnMuYWRkKGFkb3B0aW9uKVxuICAgIGNvbnN0IHJlbW92ZUFkb3B0aW9uID0gKCkgPT4ge1xuICAgICAgdGhpcy5pbmZsaWdodFdvcmtlckhhbmRvZmZBZG9wdGlvbnMuZGVsZXRlKGFkb3B0aW9uKVxuICAgICAgdGhpcy5fbWF5YmVTdG9wUmV0aXJlZCgpXG4gICAgfVxuICAgIHZvaWQgYWRvcHRpb24udGhlbihyZW1vdmVBZG9wdGlvbiwgcmVtb3ZlQWRvcHRpb24pXG4gIH1cblxuICAvKipcbiAgICogV2FpdHMgZm9yIHdvcmtlciBoYW5kb2ZmLWFkb3B0aW9uIHF1ZXJpZXMgdG8gZmluaXNoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIG5vIGFkb3B0aW9uIHF1ZXJ5IHJlbWFpbnMuXG4gICAqL1xuICBhc3luYyBfZHJhaW5Xb3JrZXJIYW5kb2ZmQWRvcHRpb25zKCkge1xuICAgIHdoaWxlICh0aGlzLmluZmxpZ2h0V29ya2VySGFuZG9mZkFkb3B0aW9ucy5zaXplID4gMCkge1xuICAgICAgYXdhaXQgUHJvbWlzZS5hbGwoWy4uLnRoaXMuaW5mbGlnaHRXb3JrZXJIYW5kb2ZmQWRvcHRpb25zXSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQWRvcHRzIGEgcmVjb25uZWN0aW5nIHdvcmtlcidzIHN0aWxsLWFjdGl2ZSBgaGFuZGVkX29mZmAgam9icyBpbnRvIGl0cyBuZXdcbiAgICogc29ja2V0J3MgaGFuZG9mZiBtYXAuIEEgZnJlc2ggbWFpbiAoZS5nLiBhZnRlciBhIGRlcGxveSByZXN0YXJ0KSBob2xkcyBub1xuICAgKiBpbi1tZW1vcnkgbGVhc2VzLCBzbyBhIHdvcmtlciB0aGF0IHJlY29ubmVjdHMgd2l0aCBpdHMgc3RhYmxlIGlkIHdvdWxkXG4gICAqIG90aGVyd2lzZSBoYXZlIGl0cyBwcmUtcmVzdGFydCBqb2JzIHRyYWNrZWQgbm93aGVyZSDigJQgaWYgaXQgdGhlbiBkaWVkLCB0aG9zZVxuICAgKiBsZWFzZXMgKGFuZCB0aGVpciBjb25jdXJyZW5jeSByZXNlcnZhdGlvbnMpIHdvdWxkIHNpdCBzdHVjayB1bnRpbCB0aGVcbiAgICogaG91cnMtbG9uZyBvcnBoYW4gc3dlZXAuIEFkb3B0aW5nIHRoZW0gbWVhbnMgYF9oYW5kbGVXb3JrZXJTb2NrZXRDbG9zZWRgXG4gICAqIHJlbGVhc2VzIHRoZW0gb24gdGhlIHdvcmtlcidzIG5leHQgZGlzY29ubmVjdCwgd2hpbGUgYSBzdGlsbC1ydW5uaW5nIHdvcmtlclxuICAgKiAoaW5jbHVkaW5nIG9uZSBncmFjZWZ1bGx5IGRyYWluaW5nKSBrZWVwcyBleGVjdXRpbmcgdGhlbSB1bnRvdWNoZWQuIE5vXG4gICAqIHRpbWUtYmFzZWQgcmVjbGFpbSBpcyB1c2VkLCBzbyBhIGRyYWluaW5nIHdvcmtlciB3aG9zZSBqb2JzIG91dGxpdmUgdGhlIG9sZFxuICAgKiBtYWluIGlzIG5ldmVyIHdyb25nbHkgcmVxdWV1ZWQgaW50byBhIGR1cGxpY2F0ZSBhdHRlbXB0LlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGpzb25Tb2NrZXQgLSBUaGUgcmVjb25uZWN0ZWQgd29ya2VyIHNvY2tldC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfYWRvcHRXb3JrZXJIYW5kb2Zmcyhqc29uU29ja2V0KSB7XG4gICAgY29uc3Qgd29ya2VySWQgPSBqc29uU29ja2V0LndvcmtlcklkXG5cbiAgICBpZiAodHlwZW9mIHdvcmtlcklkICE9PSBcInN0cmluZ1wiIHx8IHdvcmtlcklkLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgaGFuZG9mZnMgPSBhd2FpdCB0aGlzLnN0b3JlLmhhbmRlZE9mZkpvYnNGb3JXb3JrZXIoe3dvcmtlcklkfSlcbiAgICAgIGNvbnN0IG1hcCA9IHRoaXMud29ya2VySGFuZG9mZnMuZ2V0KGpzb25Tb2NrZXQpXG5cbiAgICAgIC8vIFRoZSBzb2NrZXQgbWF5IGhhdmUgY2xvc2VkIHdoaWxlIHRoZSBxdWVyeSB3YXMgaW4gZmxpZ2h0OyBpdHMgbWFwIGlzIHRoZW5cbiAgICAgIC8vIGdvbmUgYW5kIHRoZSBqb2JzIGFyZSBsZWZ0IGZvciB0aGUgb3JwaGFuIHN3ZWVwIHJhdGhlciB0aGFuIHJlc3VycmVjdGVkLlxuICAgICAgaWYgKCFtYXAgfHwgIXRoaXMud29ya2Vycy5oYXMoanNvblNvY2tldCkpIHJldHVyblxuXG4gICAgICBmb3IgKGNvbnN0IHtqb2JJZCwgaGFuZG9mZklkfSBvZiBoYW5kb2Zmcykge1xuICAgICAgICBtYXAuc2V0KGpvYklkLCBoYW5kb2ZmSWQpXG4gICAgICB9XG4gICAgICB0aGlzLnJlY29ubmVjdGVkV29ya2VySWRzLmFkZCh3b3JrZXJJZClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5fcmVwb3J0SGFuZG9mZkFkb3B0RXJyb3IoZXJyb3IpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIGNsaWVudCBzb2NrZXQgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNvY2tldE1lc3NhZ2V9IGFyZ3MubWVzc2FnZSAtIFNvY2tldCBtZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgcmVxdWVzdCBpcyBhY2tub3dsZWRnZWQuXG4gICAqL1xuICBhc3luYyBfaGFuZGxlQ2xpZW50U29ja2V0TWVzc2FnZSh7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQgJiYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwicmV0aXJpbmdcIiB8fCB0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcInJldGlyZWRcIikpIHtcbiAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImVucXVldWVcIiAmJiAhbWVzc2FnZS5wcm9kdWNlclByb29mKSBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiZW5xdWV1ZS1lcnJvclwiLCBlcnJvcjogXCJCYWNrZ3JvdW5kIGpvYnMgZ2VuZXJhdGlvbiBpcyByZXRpcmVkXCJ9KVxuICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwicmVwbGFjZS1zY2hlZHVsZWRcIikganNvblNvY2tldC5zZW5kKHt0eXBlOiBcInJlcGxhY2Utc2NoZWR1bGVkLWVycm9yXCIsIGVycm9yOiBcIkJhY2tncm91bmQgam9icyBnZW5lcmF0aW9uIGlzIHJldGlyZWRcIn0pXG4gICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJjYW5jZWwtc2NoZWR1bGVkXCIpIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJjYW5jZWwtc2NoZWR1bGVkLWVycm9yXCIsIGVycm9yOiBcIkJhY2tncm91bmQgam9icyBnZW5lcmF0aW9uIGlzIHJldGlyZWRcIn0pXG4gICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJnZXQtc2NoZWR1bGVkLWpvYlwiKSBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiZ2V0LXNjaGVkdWxlZC1qb2ItZXJyb3JcIiwgZXJyb3I6IFwiQmFja2dyb3VuZCBqb2JzIGdlbmVyYXRpb24gaXMgcmV0aXJlZFwifSlcbiAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcIndha2Utc2NoZWR1bGVkXCIpIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJ3YWtlLXNjaGVkdWxlZC1lcnJvclwiLCBlcnJvcjogXCJCYWNrZ3JvdW5kIGpvYnMgZ2VuZXJhdGlvbiBpcyByZXRpcmVkXCJ9KVxuICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgIT09IFwiZW5xdWV1ZVwiIHx8ICFtZXNzYWdlLnByb2R1Y2VyUHJvb2YpIHJldHVyblxuICAgIH1cblxuICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImVucXVldWVcIikge1xuICAgICAgYXdhaXQgdGhpcy5faGFuZGxlRW5xdWV1ZSh7anNvblNvY2tldCwgbWVzc2FnZX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJyZXBsYWNlLXNjaGVkdWxlZFwiKSB7XG4gICAgICBhd2FpdCB0aGlzLl9oYW5kbGVSZXBsYWNlU2NoZWR1bGVkKHtqc29uU29ja2V0LCBtZXNzYWdlfSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImNhbmNlbC1zY2hlZHVsZWRcIikge1xuICAgICAgYXdhaXQgdGhpcy5faGFuZGxlQ2FuY2VsU2NoZWR1bGVkKHtqc29uU29ja2V0LCBtZXNzYWdlfSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImdldC1zY2hlZHVsZWQtam9iXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZUdldFNjaGVkdWxlZEpvYih7anNvblNvY2tldCwgbWVzc2FnZX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJ3YWtlLXNjaGVkdWxlZFwiKSB7XG4gICAgICBhd2FpdCB0aGlzLl9oYW5kbGVXYWtlU2NoZWR1bGVkKHtqc29uU29ja2V0LCBtZXNzYWdlfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgd29ya2VyIHNvY2tldCBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy5qc29uU29ja2V0IC0gSlNPTiBzb2NrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU29ja2V0TWVzc2FnZX0gYXJncy5tZXNzYWdlIC0gU29ja2V0IG1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSB3b3JrZXIgbWVzc2FnZSBpcyBoYW5kbGVkLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZVdvcmtlclNvY2tldE1lc3NhZ2Uoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KSB7XG4gICAgLy8gQW55IG1lc3NhZ2UgZnJvbSB0aGUgd29ya2VyIHByb3ZlcyBpdCBpcyBhbGl2ZTsgdGhlIGxpdmVuZXNzIHN3ZWVwIHVzZXNcbiAgICAvLyB0aGlzIHRvIGRldGVjdCBhIHdlZGdlZC9zaWxlbnQgd29ya2VyLlxuICAgIGpzb25Tb2NrZXQubGFzdFNlZW5BdCA9IHRoaXMuY2xvY2subm93KClcblxuICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImhlYXJ0YmVhdFwiKSB7XG4gICAgICB0aGlzLm9uV29ya2VySGVhcnRiZWF0Py4oanNvblNvY2tldClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcInJlYWR5XCIpIHtcbiAgICAgIHRoaXMuX2hhbmRsZVdvcmtlclJlYWR5KHtqc29uU29ja2V0LCBtZXNzYWdlfSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImRyYWluaW5nXCIpIHtcbiAgICAgIHRoaXMuX2hhbmRsZVdvcmtlckRyYWluaW5nKHtqc29uU29ja2V0fSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuX2hhbmRsZVJlcG9ydGVyU29ja2V0TWVzc2FnZSh7anNvblNvY2tldCwgbWVzc2FnZX0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgcmVwb3J0ZXIgc29ja2V0IG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLmpzb25Tb2NrZXQgLSBKU09OIHNvY2tldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTb2NrZXRNZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBTb2NrZXQgbWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHJlcG9ydCBpcyBhY2tub3dsZWRnZWQuXG4gICAqL1xuICBhc3luYyBfaGFuZGxlUmVwb3J0ZXJTb2NrZXRNZXNzYWdlKHtqc29uU29ja2V0LCBtZXNzYWdlfSkge1xuICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCAmJiB0aGlzLl9nZW5lcmF0aW9uUmVwb3J0SXNJbnZhbGlkKG1lc3NhZ2UpKSB7XG4gICAgICBpZiAoXCJqb2JJZFwiIGluIG1lc3NhZ2UgJiYgdHlwZW9mIG1lc3NhZ2Uuam9iSWQgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImpvYi11cGRhdGUtZXJyb3JcIiwgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsIGVycm9yOiBcIkdlbmVyYXRpb24gb3duZXJzaGlwIHJlamVjdGVkXCJ9KVxuICAgICAgfVxuICAgICAgcmV0dXJuXG4gICAgfVxuICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImpvYi1hY2NlcHRlZFwiKSB7XG4gICAgICBhd2FpdCB0aGlzLl9oYW5kbGVKb2JBY2NlcHRlZCh7anNvblNvY2tldCwgbWVzc2FnZX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJqb2ItY29tcGxldGVcIikge1xuICAgICAgYXdhaXQgdGhpcy5faGFuZGxlSm9iQ29tcGxldGUoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiam9iLWZhaWxlZFwiKSB7XG4gICAgICBhd2FpdCB0aGlzLl9oYW5kbGVKb2JGYWlsZWQoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiam9iLXJlc2NoZWR1bGVcIikge1xuICAgICAgYXdhaXQgdGhpcy5faGFuZGxlSm9iUmVzY2hlZHVsZSh7anNvblNvY2tldCwgbWVzc2FnZX0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFBlcnNpc3RzIHBvb2xlZC1jaGlsZCBhY2NlcHRhbmNlIGV2aWRlbmNlIGZvciBhbiBhY3RpdmUgaGFuZG9mZi4gVGhlXG4gICAqIHJlcG9ydCBpcyBkaWFnbm9zdGljOiBhIHN0YWxlIGxlYXNlIChqb2IgYWxyZWFkeSByZWNsYWltZWQgb3IgdGVybWluYWwpXG4gICAqIGFuc3dlcnMgdGhlIHNhbWUgYGpvYi11cGRhdGVkYCBhY2tub3dsZWRnZW1lbnQgYXMgYW4gYWNjZXB0ZWQgcmVwb3J0LCBhbmRcbiAgICogb25seSBhIHN0b3JlIGZhaWx1cmUgYW5zd2VycyBgam9iLXVwZGF0ZS1lcnJvcmAgc28gdGhlIHdvcmtlciBjYW4gcmV0cnkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLmpzb25Tb2NrZXQgLSBKU09OIHNvY2tldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JBY2NlcHRlZE1lc3NhZ2V9IGFyZ3MubWVzc2FnZSAtIE1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gaGFuZGxlZC5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVKb2JBY2NlcHRlZCh7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5zdG9yZS5tYXJrQ2hpbGRBY2NlcHRlZCh7XG4gICAgICAgIGNoaWxkSW5zdGFuY2VJZDogbWVzc2FnZS5jaGlsZEluc3RhbmNlSWQsXG4gICAgICAgIGNoaWxkUGlkOiBtZXNzYWdlLmNoaWxkUGlkLFxuICAgICAgICBoYW5kZWRPZmZBdE1zOiBtZXNzYWdlLmhhbmRlZE9mZkF0TXMsXG4gICAgICAgIGhhbmRvZmZJZDogbWVzc2FnZS5oYW5kb2ZmSWQsXG4gICAgICAgIGpvYklkOiBtZXNzYWdlLmpvYklkLFxuICAgICAgICByZWNlaXZlZEF0TXM6IG1lc3NhZ2UucmVjZWl2ZWRBdE1zLFxuICAgICAgICBzdGFydGVkQXRNczogbWVzc2FnZS5zdGFydGVkQXRNcyxcbiAgICAgICAgd29ya2VySWQ6IG1lc3NhZ2Uud29ya2VySWRcbiAgICAgIH0pXG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiam9iLXVwZGF0ZWRcIiwgam9iSWQ6IG1lc3NhZ2Uuam9iSWR9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLl9yZXBvcnRKb2JVcGRhdGVGYWlsdXJlKHtlcnJvciwgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsIHN0YWdlOiBcImJhY2tncm91bmQtam9iLWFjY2VwdGVkXCJ9KVxuICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImpvYi11cGRhdGUtZXJyb3JcIiwgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsIGVycm9yOiBcIkZhaWxlZCB0byB1cGRhdGUgam9iXCJ9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXF1aXJlcyB0aGUgY29tcGxldGUgZHVyYWJsZSBsZWFzZSBpZGVudGl0eSBiZWZvcmUgYSBnZW5lcmF0aW9uLW1vZGVcbiAgICogcmVwb3J0ZXIgY2FuIG11dGF0ZSBhIGpvYi4gTGVnYWN5IHJlcG9ydGVycyBrZWVwIHRoZWlyIHBlcm1pc3NpdmUgcHJvdG9jb2wuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU29ja2V0TWVzc2FnZX0gbWVzc2FnZSAtIFJlcG9ydGVyIG1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIHJlcG9ydCBsYWNrcyBpdHMgZXhhY3QgZ2VuZXJhdGlvbiBsZWFzZS5cbiAgICovXG4gIF9nZW5lcmF0aW9uUmVwb3J0SXNJbnZhbGlkKG1lc3NhZ2UpIHtcbiAgICBpZiAobWVzc2FnZT8udHlwZSAhPT0gXCJqb2ItYWNjZXB0ZWRcIiAmJiBtZXNzYWdlPy50eXBlICE9PSBcImpvYi1jb21wbGV0ZVwiICYmIG1lc3NhZ2U/LnR5cGUgIT09IFwiam9iLWZhaWxlZFwiICYmIG1lc3NhZ2U/LnR5cGUgIT09IFwiam9iLXJlc2NoZWR1bGVcIikgcmV0dXJuIGZhbHNlXG4gICAgY29uc3QgZ2VuZXJhdGlvbklkID0gdGhpcy5nZW5lcmF0aW9uSWRcbiAgICBpZiAoIWdlbmVyYXRpb25JZCkgcmV0dXJuIGZhbHNlXG5cbiAgICByZXR1cm4gdHlwZW9mIG1lc3NhZ2UuaGFuZG9mZklkICE9PSBcInN0cmluZ1wiXG4gICAgICB8fCB0eXBlb2YgbWVzc2FnZS5oYW5kZWRPZmZBdE1zICE9PSBcIm51bWJlclwiXG4gICAgICB8fCAhd29ya2VySWRCZWxvbmdzVG9HZW5lcmF0aW9uKHtnZW5lcmF0aW9uSWQsIHdvcmtlcklkOiBtZXNzYWdlLndvcmtlcklkfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSB3b3JrZXIgcmVhZHkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLmpzb25Tb2NrZXQgLSBKU09OIHNvY2tldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSZWFkeU1lc3NhZ2V9IGFyZ3MubWVzc2FnZSAtIFJlYWR5IG1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2hhbmRsZVdvcmtlclJlYWR5KHtqc29uU29ja2V0LCBtZXNzYWdlfSkge1xuICAgIGlmICh0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcInJldGlyaW5nXCIgfHwgdGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJyZXRpcmVkXCIpIHtcbiAgICAgIHRoaXMucmVhZHlXb3JrZXJzLmRlbGV0ZShqc29uU29ja2V0KVxuICAgICAgdGhpcy5jYW5kaWRhdGVSZWFkeVdvcmtlcnMuZGVsZXRlKGpzb25Tb2NrZXQpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBqc29uU29ja2V0LnJlYWRpbmVzc1ZlcnNpb24gKz0gMVxuICAgIGpzb25Tb2NrZXQuYWNjZXB0c1NwYXduZWRKb2JzID0gbWVzc2FnZS5hY2NlcHRzU3Bhd25lZCAhPT0gZmFsc2UgJiYgbWVzc2FnZS5hY2NlcHRzRm9ya2VkICE9PSBmYWxzZVxuICAgIGpzb25Tb2NrZXQuYWNjZXB0c0ZvcmtlZEpvYnMgPSBtZXNzYWdlLmFjY2VwdHNGb3JrZWQgIT09IGZhbHNlXG4gICAganNvblNvY2tldC5hY2NlcHRzUG9vbGVkSm9icyA9IG1lc3NhZ2UuYWNjZXB0c1Bvb2xlZCA9PT0gdHJ1ZVxuICAgIGNvbnN0IGF2YWlsYWJsZVBvb2xlZFNsb3RzID0gbWVzc2FnZS5hdmFpbGFibGVQb29sZWRTbG90c1xuICAgIGpzb25Tb2NrZXQudXNlc1Bvb2xlZENhcGFjaXR5Q3JlZGl0cyA9IE51bWJlci5pc0ludGVnZXIoYXZhaWxhYmxlUG9vbGVkU2xvdHMpXG4gICAganNvblNvY2tldC5hdmFpbGFibGVQb29sZWRTbG90cyA9IE51bWJlci5pc0ludGVnZXIoYXZhaWxhYmxlUG9vbGVkU2xvdHMpICYmIGF2YWlsYWJsZVBvb2xlZFNsb3RzICE9PSB1bmRlZmluZWQgJiYgYXZhaWxhYmxlUG9vbGVkU2xvdHMgPiAwXG4gICAgICA/IGF2YWlsYWJsZVBvb2xlZFNsb3RzXG4gICAgICA6IDBcbiAgICBqc29uU29ja2V0LmFjY2VwdHNJbmxpbmVKb2JzID0gbWVzc2FnZS5hY2NlcHRzSW5saW5lICE9PSBmYWxzZVxuICAgIGlmICh0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcImNhbmRpZGF0ZVwiKSB7XG4gICAgICB0aGlzLnJlYWR5V29ya2Vycy5kZWxldGUoanNvblNvY2tldClcbiAgICAgIGlmICghanNvblNvY2tldC5pc0RyYWluaW5nKSB0aGlzLmNhbmRpZGF0ZVJlYWR5V29ya2Vycy5hZGQoanNvblNvY2tldClcbiAgICB9IGVsc2UgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwiYWN0aXZlXCIgJiYgdGhpcy5fYWN0aXZlT3duZXJzaGlwUmVhZHkgJiYganNvblNvY2tldC5zdXBwb3J0c0hhbmRvZmZJZFJlcG9ydGluZyAmJiAhanNvblNvY2tldC5pc0RyYWluaW5nKSB7XG4gICAgICB0aGlzLnJlYWR5V29ya2Vycy5hZGQoanNvblNvY2tldClcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5yZWFkeVdvcmtlcnMuZGVsZXRlKGpzb25Tb2NrZXQpXG4gICAgICB0aGlzLmNhbmRpZGF0ZVJlYWR5V29ya2Vycy5kZWxldGUoanNvblNvY2tldClcbiAgICB9XG4gICAgdGhpcy5vbldvcmtlclJlYWR5Py4oanNvblNvY2tldClcbiAgICB2b2lkIHRoaXMuX2RyYWluKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSB3b3JrZXIgZHJhaW5pbmcuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLmpzb25Tb2NrZXQgLSBKU09OIHNvY2tldC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaGFuZGxlV29ya2VyRHJhaW5pbmcoe2pzb25Tb2NrZXR9KSB7XG4gICAgLy8gVGhlIHdvcmtlciBpcyBzaHV0dGluZyBkb3duIGdyYWNlZnVsbHkuIFN0b3AgZGlzcGF0Y2hpbmcgbmV3IGpvYnNcbiAgICAvLyB0byBpdCBidXQga2VlcCB0aGUgY29ubmVjdGlvbiBpbiBgd29ya2Vyc2Agc28gYW55IGluLWZsaWdodCBqb2JcbiAgICAvLyBpdCdzIHN0aWxsIGRyYWluaW5nIGNhbiByZXBvcnQgaXRzIHJlc3VsdC5cbiAgICBqc29uU29ja2V0LmlzRHJhaW5pbmcgPSB0cnVlXG4gICAgdGhpcy5yZWFkeVdvcmtlcnMuZGVsZXRlKGpzb25Tb2NrZXQpXG4gICAgdGhpcy5jYW5kaWRhdGVSZWFkeVdvcmtlcnMuZGVsZXRlKGpzb25Tb2NrZXQpXG4gIH1cblxuICAvKipcbiAgICogUmVtb3ZlcyBhIGxvc3Qgd29ya2VyIHNvY2tldCBhbmQgcmVsZWFzZXMgb25seSBsZWFzZXMgZGlzcGF0Y2hlZCB0aHJvdWdoIGl0LlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IHdvcmtlciAtIERpc2Nvbm5lY3RlZCB3b3JrZXIgc29ja2V0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gQ29vcmRpbmF0aW9uIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MucXVldWVSZWRyYWluXSAtIFF1ZXVlIGFub3RoZXIgcGFzcyBpbnN0ZWFkIG9mIGF3YWl0aW5nIHRoZSBhY3RpdmUgZHJhaW4uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGl0cyBhY3RpdmUgbGVhc2VzIGFyZSByZWxlYXNlZC5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVXb3JrZXJTb2NrZXRDbG9zZWQod29ya2VyLCB7cXVldWVSZWRyYWluID0gZmFsc2V9ID0ge30pIHtcbiAgICB0aGlzLndvcmtlcnMuZGVsZXRlKHdvcmtlcilcbiAgICB0aGlzLnJlYWR5V29ya2Vycy5kZWxldGUod29ya2VyKVxuICAgIHRoaXMuY2FuZGlkYXRlUmVhZHlXb3JrZXJzLmRlbGV0ZSh3b3JrZXIpXG5cbiAgICBpZiAodGhpcy5fc3RvcHBlZCkge1xuICAgICAgdGhpcy53b3JrZXJIYW5kb2Zmcy5kZWxldGUod29ya2VyKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgaGFuZG9mZnMgPSB0aGlzLndvcmtlckhhbmRvZmZzLmdldCh3b3JrZXIpXG4gICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkICYmIHdvcmtlci53b3JrZXJJZCAmJiBoYW5kb2ZmcyAmJiBoYW5kb2Zmcy5zaXplID4gMCkge1xuICAgICAgY29uc3QgZXhpc3RpbmcgPSB0aGlzLmRpc2Nvbm5lY3RlZFdvcmtlcnMuZ2V0KHdvcmtlci53b3JrZXJJZClcbiAgICAgIGlmIChleGlzdGluZz8ud29ya2VyID09PSB3b3JrZXIpIHJldHVyblxuICAgICAgaWYgKGV4aXN0aW5nKSB0aGlzLmNsb2NrLmNsZWFyVGltZW91dChleGlzdGluZy50aW1lcilcblxuICAgICAgY29uc3QgdGltZXIgPSB0aGlzLmNsb2NrLnNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICB0aGlzLmRpc2Nvbm5lY3RlZFdvcmtlcnMuZGVsZXRlKHdvcmtlci53b3JrZXJJZCB8fCBcIlwiKVxuICAgICAgICB2b2lkIHRoaXMuX3JlbGVhc2VXb3JrZXJIYW5kb2Zmcyh3b3JrZXIpLnRoZW4oKCkgPT4ge1xuICAgICAgICAgIGlmICh3b3JrZXIud29ya2VySWQpIHRoaXMub25Xb3JrZXJIYW5kb2Zmc1JlbGVhc2VkPy4od29ya2VyLndvcmtlcklkKVxuICAgICAgICB9LCAoZXJyb3IpID0+IHtcbiAgICAgICAgICB0aGlzLl9yZXBvcnRIYW5kb2ZmUmVsZWFzZUVycm9yKGVycm9yKVxuICAgICAgICAgIHRoaXMuX3NjaGVkdWxlRXJyb3JSZXRyeSgpXG4gICAgICAgIH0pXG4gICAgICB9LCB0aGlzLndvcmtlclJlY29ubmVjdEdyYWNlTXMpXG4gICAgICBpZiAodHlwZW9mIHRpbWVyID09PSBcIm9iamVjdFwiKSB0aW1lci51bnJlZigpXG4gICAgICB0aGlzLmRpc2Nvbm5lY3RlZFdvcmtlcnMuc2V0KHdvcmtlci53b3JrZXJJZCwge3dvcmtlciwgdGltZXJ9KVxuICAgICAgdGhpcy5vbldvcmtlckRpc2Nvbm5lY3RlZD8uKHdvcmtlci53b3JrZXJJZClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlV29ya2VySGFuZG9mZnMod29ya2VyLCB7cXVldWVSZWRyYWlufSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5fcmVwb3J0SGFuZG9mZlJlbGVhc2VFcnJvcihlcnJvcilcbiAgICAgIHRoaXMuX3NjaGVkdWxlRXJyb3JSZXRyeSgpXG4gICAgfVxuICAgIHRoaXMuX21heWJlU3RvcFJldGlyZWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbGVhc2VzIGFsbCBsZWFzZXMgc3RpbGwgb3duZWQgYnkgb25lIGV4YWN0IHdvcmtlciBzb2NrZXQuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gd29ya2VyIC0gV29ya2VyIHNvY2tldC5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIENvb3JkaW5hdGlvbiBvcHRpb25zLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLnF1ZXVlUmVkcmFpbl0gLSBRdWV1ZSBhbm90aGVyIHBhc3MgaW5zdGVhZCBvZiBhd2FpdGluZyB0aGUgYWN0aXZlIGRyYWluLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBmZW5jZWQgcmVsZWFzZXMgYW5kIGRpc3BhdGNoIHdha2UtdXAuXG4gICAqL1xuICBhc3luYyBfcmVsZWFzZVdvcmtlckhhbmRvZmZzKHdvcmtlciwge3F1ZXVlUmVkcmFpbiA9IGZhbHNlfSA9IHt9KSB7XG4gICAgY29uc3QgaGFuZG9mZnMgPSB0aGlzLndvcmtlckhhbmRvZmZzLmdldCh3b3JrZXIpXG5cbiAgICBpZiAoIWhhbmRvZmZzIHx8IGhhbmRvZmZzLnNpemUgPT09IDApIHtcbiAgICAgIHRoaXMud29ya2VySGFuZG9mZnMuZGVsZXRlKHdvcmtlcilcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGZvciAoY29uc3QgW2pvYklkLCBoYW5kb2ZmSWRdIG9mIGhhbmRvZmZzKSB7XG4gICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlSGFuZG9mZih7aGFuZG9mZklkLCBqb2JJZCwgd29ya2VyfSlcbiAgICB9XG5cbiAgICB0aGlzLndvcmtlckhhbmRvZmZzLmRlbGV0ZSh3b3JrZXIpXG4gICAgdGhpcy5fbm90aWZ5RW5xdWV1ZWQoKVxuICAgIGlmIChxdWV1ZVJlZHJhaW4pIHtcbiAgICAgIHRoaXMuX3JlZHJhaW5RdWV1ZWQgPSB0cnVlXG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICh0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcImFjdGl2ZVwiKSBhd2FpdCB0aGlzLl9kcmFpbigpXG4gICAgfVxuICAgIHRoaXMuX21heWJlU3RvcFJldGlyZWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb25lIGlkZW1wb3RlbnQgY29uZGl0aW9uYWwgbGVhc2UgcmVsZWFzZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5oYW5kb2ZmSWQgLSBIYW5kb2ZmIGxlYXNlIGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLndvcmtlciAtIFNvY2tldCB0aGF0IHJlY2VpdmVkIHRoZSBsZWFzZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIGZlbmNlZCB0cmFuc2l0aW9uLlxuICAgKi9cbiAgYXN5bmMgX3JlbGVhc2VIYW5kb2ZmKHtoYW5kb2ZmSWQsIGpvYklkLCB3b3JrZXJ9KSB7XG4gICAgYXdhaXQgdGhpcy5zdG9yZS5tYXJrUmV0dXJuZWRUb1F1ZXVlKHtoYW5kb2ZmSWQsIGpvYklkfSlcblxuICAgIGNvbnN0IGhhbmRvZmZzID0gdGhpcy53b3JrZXJIYW5kb2Zmcy5nZXQod29ya2VyKVxuXG4gICAgaWYgKGhhbmRvZmZzPy5nZXQoam9iSWQpID09PSBoYW5kb2ZmSWQpIGhhbmRvZmZzLmRlbGV0ZShqb2JJZClcbiAgfVxuXG4gIC8qKlxuICAgKiBGb3JnZXRzIGEgc3VjY2Vzc2Z1bGx5IHJlcG9ydGVkIGxlYXNlIHdpdGhvdXQgcmVseWluZyBvbiB3b3JrZXIgaWRzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmhhbmRvZmZJZCAtIEhhbmRvZmYgbGVhc2UgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9mb3JnZXRIYW5kb2ZmKHtoYW5kb2ZmSWQsIGpvYklkfSkge1xuICAgIGZvciAoY29uc3QgW3dvcmtlciwgaGFuZG9mZnNdIG9mIHRoaXMud29ya2VySGFuZG9mZnMpIHtcbiAgICAgIGlmIChoYW5kb2Zmcy5nZXQoam9iSWQpICE9PSBoYW5kb2ZmSWQpIGNvbnRpbnVlXG5cbiAgICAgIGhhbmRvZmZzLmRlbGV0ZShqb2JJZClcbiAgICAgIGlmIChoYW5kb2Zmcy5zaXplID09PSAwICYmICF0aGlzLndvcmtlcnMuaGFzKHdvcmtlcikpIHRoaXMud29ya2VySGFuZG9mZnMuZGVsZXRlKHdvcmtlcilcbiAgICAgIGlmIChoYW5kb2Zmcy5zaXplID09PSAwICYmIHdvcmtlci53b3JrZXJJZCkge1xuICAgICAgICBjb25zdCBkaXNjb25uZWN0ZWQgPSB0aGlzLmRpc2Nvbm5lY3RlZFdvcmtlcnMuZ2V0KHdvcmtlci53b3JrZXJJZClcbiAgICAgICAgaWYgKGRpc2Nvbm5lY3RlZD8ud29ya2VyID09PSB3b3JrZXIpIHtcbiAgICAgICAgICB0aGlzLmNsb2NrLmNsZWFyVGltZW91dChkaXNjb25uZWN0ZWQudGltZXIpXG4gICAgICAgICAgdGhpcy5kaXNjb25uZWN0ZWRXb3JrZXJzLmRlbGV0ZSh3b3JrZXIud29ya2VySWQpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHRoaXMuX21heWJlU3RvcFJldGlyZWQoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcG9ydHMgYW4gdW5leHBlY3RlZCBsZWFzZS1yZWxlYXNlIGZhaWx1cmUgb24gZnJhbWV3b3JrIGVycm9yIGNoYW5uZWxzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBlcnJvciAtIFJlbGVhc2UgZmFpbHVyZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVwb3J0SGFuZG9mZlJlbGVhc2VFcnJvcihlcnJvcikge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKVxuICAgIGNvbnN0IHBheWxvYWQgPSB7Y29udGV4dDoge3N0YWdlOiBcImJhY2tncm91bmQtam9iLWhhbmRvZmYtcmVsZWFzZVwifSwgZXJyb3I6IG5vcm1hbGl6ZWRFcnJvcn1cbiAgICBjb25zdCBlcnJvckV2ZW50cyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpXG5cbiAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJGYWlsZWQgdG8gcmVsZWFzZSBkaXNjb25uZWN0ZWQgd29ya2VyIGhhbmRvZmZzOlwiLCBub3JtYWxpemVkRXJyb3JdKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcG9ydHMgYW4gdW5leHBlY3RlZCB3b3JrZXItaGFuZG9mZiBhZG9wdGlvbiBmYWlsdXJlIG9uIGZyYW1ld29yayBlcnJvclxuICAgKiBjaGFubmVscy4gQSBmYWlsZWQgYWRvcHRpb24gaXMgbm90IGZhdGFsICh0aGUgd29ya2VyJ3Mgam9icyByZW1haW4gYW5kIGFyZVxuICAgKiByZWNsYWltZWQgYnkgdGhlIG9ycGhhbiBzd2VlcCksIGJ1dCBtdXN0IHN1cmZhY2UgcmF0aGVyIHRoYW4gYmUgc3dhbGxvd2VkLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBlcnJvciAtIEFkb3B0aW9uIGZhaWx1cmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlcG9ydEhhbmRvZmZBZG9wdEVycm9yKGVycm9yKSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG4gICAgY29uc3QgcGF5bG9hZCA9IHtjb250ZXh0OiB7c3RhZ2U6IFwiYmFja2dyb3VuZC1qb2ItaGFuZG9mZi1hZG9wdFwifSwgZXJyb3I6IG5vcm1hbGl6ZWRFcnJvcn1cbiAgICBjb25zdCBlcnJvckV2ZW50cyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpXG5cbiAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJGYWlsZWQgdG8gYWRvcHQgcmVjb25uZWN0ZWQgd29ya2VyIGhhbmRvZmZzOlwiLCBub3JtYWxpemVkRXJyb3JdKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcG9ydHMgYW4gdW5leHBlY3RlZCBzdGFydHVwLXNuYXBzaG90IHJlY2xhaW0gZmFpbHVyZSB3aGlsZSByZXRhaW5pbmcgdGhlXG4gICAqIHNuYXBzaG90IGZvciB0aGUgZGlzcGF0Y2hlcidzIGV4aXN0aW5nIHRyYW5zaWVudC1lcnJvciByZXRyeSBsaWZlY3ljbGUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gUmVjbGFpbSBmYWlsdXJlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXBvcnRTdGFydHVwSGFuZG9mZlJlY2xhaW1FcnJvcihlcnJvcikge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKVxuICAgIGNvbnN0IHBheWxvYWQgPSB7Y29udGV4dDoge3N0YWdlOiBcImJhY2tncm91bmQtam9iLXN0YXJ0dXAtaGFuZG9mZi1yZWNsYWltXCJ9LCBlcnJvcjogbm9ybWFsaXplZEVycm9yfVxuICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIkZhaWxlZCB0byByZWNsYWltIGRpc2Nvbm5lY3RlZCBzdGFydHVwIGhhbmRvZmZzOlwiLCBub3JtYWxpemVkRXJyb3JdKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIGVucXVldWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLmpzb25Tb2NrZXQgLSBKU09OIHNvY2tldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFbnF1ZXVlTWVzc2FnZX0gYXJncy5tZXNzYWdlIC0gTWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBoYW5kbGVkLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZUVucXVldWUoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KSB7XG4gICAgdHJ5IHtcbiAgICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZFxuICAgICAgICAmJiB0eXBlb2YgbWVzc2FnZS5wcm9kdWNlclByb29mPy53b3JrZXJJZCA9PT0gXCJzdHJpbmdcIlxuICAgICAgICAmJiAhd29ya2VySWRCZWxvbmdzVG9HZW5lcmF0aW9uKHtnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkLCB3b3JrZXJJZDogbWVzc2FnZS5wcm9kdWNlclByb29mLndvcmtlcklkfSkpIHtcbiAgICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShcIkJhY2tncm91bmQgam9iIHByb2R1Y2VyIGhhbmRvZmYgYmVsb25ncyB0byBhbm90aGVyIGdlbmVyYXRpb24uXCIsIHtcbiAgICAgICAgICBjb2RlOiBcImJhY2tncm91bmQtam9iLXByb2R1Y2VyLWdlbmVyYXRpb24tbWlzbWF0Y2hcIlxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICBjb25zdCByZXF1ZXN0ID0ge1xuICAgICAgICBqb2JOYW1lOiBtZXNzYWdlLmpvYk5hbWUsXG4gICAgICAgIGFyZ3M6IG1lc3NhZ2UuYXJncyB8fCBbXSxcbiAgICAgICAgb3B0aW9uczogbWVzc2FnZS5vcHRpb25zIHx8IHt9XG4gICAgICB9XG4gICAgICBjb25zdCBqb2JJZCA9IHRoaXMuZ2VuZXJhdGlvbklkICYmIG1lc3NhZ2UucHJvZHVjZXJQcm9vZlxuICAgICAgICA/IGF3YWl0IHRoaXMuc3RvcmUuZW5xdWV1ZUZyb21Pd25lZEhhbmRvZmYoey4uLnJlcXVlc3QsIHByb2R1Y2VySW52b2NhdGlvbklkOiBtZXNzYWdlLnByb2R1Y2VySW52b2NhdGlvbklkLCBwcm9kdWNlclByb29mOiBtZXNzYWdlLnByb2R1Y2VyUHJvb2Z9KVxuICAgICAgICA6IGF3YWl0IHRoaXMuc3RvcmUuZW5xdWV1ZShyZXF1ZXN0KVxuXG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiZW5xdWV1ZWRcIiwgam9iSWR9KVxuICAgICAgdGhpcy5fbm90aWZ5RW5xdWV1ZWQoKVxuICAgICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwiYWN0aXZlXCIpIGF3YWl0IHRoaXMuX2RyYWluKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5faGFuZGxlQ2xpZW50TXV0YXRpb25FcnJvcih7XG4gICAgICAgIGNvbnRleHQ6IHtqb2JOYW1lOiBtZXNzYWdlLmpvYk5hbWUsIHN0YWdlOiBcImJhY2tncm91bmQtam9iLWVucXVldWVcIn0sXG4gICAgICAgIGVycm9yLFxuICAgICAgICBmYWxsYmFja01lc3NhZ2U6IFwiRmFpbGVkIHRvIGVucXVldWUgam9iXCIsXG4gICAgICAgIGpzb25Tb2NrZXQsXG4gICAgICAgIGxvZ01lc3NhZ2U6IFwiRmFpbGVkIHRvIGVucXVldWUgYmFja2dyb3VuZCBqb2I6XCIsXG4gICAgICAgIHJlc3BvbnNlVHlwZTogXCJlbnF1ZXVlLWVycm9yXCJcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEhhbmRsZXMgYSBzdGFibGUta2V5IHJlcGxhY2VtZW50IHJlcXVlc3QgYW5kIHJlLWFybXMgZGlzcGF0Y2ggYWZ0ZXJ3YXJkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy5qc29uU29ja2V0IC0gSlNPTiBzb2NrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUmVwbGFjZVNjaGVkdWxlZE1lc3NhZ2V9IGFyZ3MubWVzc2FnZSAtIE1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gaGFuZGxlZC5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVSZXBsYWNlU2NoZWR1bGVkKHtqc29uU29ja2V0LCBtZXNzYWdlfSkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnN0b3JlLnJlcGxhY2VTY2hlZHVsZWQoe1xuICAgICAgICBzY2hlZHVsZUtleTogbWVzc2FnZS5zY2hlZHVsZUtleSxcbiAgICAgICAgam9iTmFtZTogbWVzc2FnZS5qb2JOYW1lLFxuICAgICAgICBhcmdzOiBtZXNzYWdlLmFyZ3MgfHwgW10sXG4gICAgICAgIG9wdGlvbnM6IG1lc3NhZ2Uub3B0aW9ucyB8fCB7fVxuICAgICAgfSlcblxuICAgICAgdGhpcy5fbm90aWZ5RW5xdWV1ZWQoKVxuICAgICAgYXdhaXQgdGhpcy5fZHJhaW4oKVxuICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcInNjaGVkdWxlLXJlcGxhY2VkXCIsIC4uLnJlc3VsdH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuX2hhbmRsZUNsaWVudE11dGF0aW9uRXJyb3Ioe1xuICAgICAgICBjb250ZXh0OiB7am9iTmFtZTogbWVzc2FnZS5qb2JOYW1lLCBzY2hlZHVsZUtleTogbWVzc2FnZS5zY2hlZHVsZUtleSwgc3RhZ2U6IFwiYmFja2dyb3VuZC1qb2ItcmVwbGFjZS1zY2hlZHVsZWRcIn0sXG4gICAgICAgIGVycm9yLFxuICAgICAgICBmYWxsYmFja01lc3NhZ2U6IFwiRmFpbGVkIHRvIHJlcGxhY2Ugc2NoZWR1bGVkIGpvYlwiLFxuICAgICAgICBqc29uU29ja2V0LFxuICAgICAgICBsb2dNZXNzYWdlOiBcIkZhaWxlZCB0byByZXBsYWNlIHNjaGVkdWxlZCBiYWNrZ3JvdW5kIGpvYjpcIixcbiAgICAgICAgcmVzcG9uc2VUeXBlOiBcInJlcGxhY2Utc2NoZWR1bGVkLWVycm9yXCJcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEhhbmRsZXMgYSBzdGFibGUta2V5IGNhbmNlbGxhdGlvbiByZXF1ZXN0IGFuZCByZS1hcm1zIGRpc3BhdGNoIGFmdGVyd2FyZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkNhbmNlbFNjaGVkdWxlZE1lc3NhZ2V9IGFyZ3MubWVzc2FnZSAtIE1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gaGFuZGxlZC5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVDYW5jZWxTY2hlZHVsZWQoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuc3RvcmUuY2FuY2VsU2NoZWR1bGVkKG1lc3NhZ2Uuc2NoZWR1bGVLZXkpXG5cbiAgICAgIHRoaXMuX25vdGlmeUVucXVldWVkKClcbiAgICAgIGF3YWl0IHRoaXMuX2RyYWluKClcbiAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJzY2hlZHVsZS1jYW5jZWxsZWRcIiwgLi4ucmVzdWx0fSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5faGFuZGxlQ2xpZW50TXV0YXRpb25FcnJvcih7XG4gICAgICAgIGNvbnRleHQ6IHtzY2hlZHVsZUtleTogbWVzc2FnZS5zY2hlZHVsZUtleSwgc3RhZ2U6IFwiYmFja2dyb3VuZC1qb2ItY2FuY2VsLXNjaGVkdWxlZFwifSxcbiAgICAgICAgZXJyb3IsXG4gICAgICAgIGZhbGxiYWNrTWVzc2FnZTogXCJGYWlsZWQgdG8gY2FuY2VsIHNjaGVkdWxlZCBqb2JcIixcbiAgICAgICAganNvblNvY2tldCxcbiAgICAgICAgbG9nTWVzc2FnZTogXCJGYWlsZWQgdG8gY2FuY2VsIHNjaGVkdWxlZCBiYWNrZ3JvdW5kIGpvYjpcIixcbiAgICAgICAgcmVzcG9uc2VUeXBlOiBcImNhbmNlbC1zY2hlZHVsZWQtZXJyb3JcIlxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSGFuZGxlcyBhIHN0YWJsZSBzY2hlZHVsZSBsb29rdXAgYW5kIHJldHVybnMgb25seSBub3JtYWxpemVkIGFkYXB0ZXIgam9icy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkdldFNjaGVkdWxlZE1lc3NhZ2V9IGFyZ3MubWVzc2FnZSAtIE1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gaGFuZGxlZC5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVHZXRTY2hlZHVsZWRKb2Ioe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuc3RvcmUuZ2V0U2NoZWR1bGVkSm9iKG1lc3NhZ2Uuc2NoZWR1bGVLZXksIHtcbiAgICAgICAgaW5jbHVkZUxhdGVzdFRlcm1pbmFsOiBtZXNzYWdlLmluY2x1ZGVMYXRlc3RUZXJtaW5hbFxuICAgICAgfSlcblxuICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcInNjaGVkdWxlZC1qb2JcIiwgLi4ucmVzdWx0fSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5faGFuZGxlQ2xpZW50TXV0YXRpb25FcnJvcih7XG4gICAgICAgIGNvbnRleHQ6IHtzY2hlZHVsZUtleTogbWVzc2FnZS5zY2hlZHVsZUtleSwgc3RhZ2U6IFwiYmFja2dyb3VuZC1qb2ItZ2V0LXNjaGVkdWxlZFwifSxcbiAgICAgICAgZXJyb3IsXG4gICAgICAgIGZhbGxiYWNrTWVzc2FnZTogXCJGYWlsZWQgdG8gcmVhZCBzY2hlZHVsZWQgam9iXCIsXG4gICAgICAgIGpzb25Tb2NrZXQsXG4gICAgICAgIGxvZ01lc3NhZ2U6IFwiRmFpbGVkIHRvIHJlYWQgc2NoZWR1bGVkIGJhY2tncm91bmQgam9iOlwiLFxuICAgICAgICByZXNwb25zZVR5cGU6IFwiZ2V0LXNjaGVkdWxlZC1qb2ItZXJyb3JcIlxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSGFuZGxlcyBhIHN0YWJsZSBzY2hlZHVsZSB3YWtlIGFuZCByZS1hcm1zIGRpc3BhdGNoIGFmdGVyIGl0cyB0cmFuc2FjdGlvbiBjb21taXRzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy5qc29uU29ja2V0IC0gSlNPTiBzb2NrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iV2FrZVNjaGVkdWxlZE1lc3NhZ2V9IGFyZ3MubWVzc2FnZSAtIE1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gaGFuZGxlZC5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVXYWtlU2NoZWR1bGVkKHtqc29uU29ja2V0LCBtZXNzYWdlfSkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnN0b3JlLndha2VTY2hlZHVsZWQobWVzc2FnZS5zY2hlZHVsZUtleSlcblxuICAgICAgaWYgKHJlc3VsdC5vdXRjb21lID09PSBcIndva2VuXCIgfHwgcmVzdWx0Lm91dGNvbWUgPT09IFwiYWxyZWFkeV9kdWVcIikge1xuICAgICAgICB0aGlzLl9ub3RpZnlFbnF1ZXVlZCgpXG4gICAgICAgIGF3YWl0IHRoaXMuX2RyYWluKClcbiAgICAgIH1cblxuICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcInNjaGVkdWxlLXdva2VuXCIsIC4uLnJlc3VsdH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuX2hhbmRsZUNsaWVudE11dGF0aW9uRXJyb3Ioe1xuICAgICAgICBjb250ZXh0OiB7c2NoZWR1bGVLZXk6IG1lc3NhZ2Uuc2NoZWR1bGVLZXksIHN0YWdlOiBcImJhY2tncm91bmQtam9iLXdha2Utc2NoZWR1bGVkXCJ9LFxuICAgICAgICBlcnJvcixcbiAgICAgICAgZmFsbGJhY2tNZXNzYWdlOiBcIkZhaWxlZCB0byB3YWtlIHNjaGVkdWxlZCBqb2JcIixcbiAgICAgICAganNvblNvY2tldCxcbiAgICAgICAgbG9nTWVzc2FnZTogXCJGYWlsZWQgdG8gd2FrZSBzY2hlZHVsZWQgYmFja2dyb3VuZCBqb2I6XCIsXG4gICAgICAgIHJlc3BvbnNlVHlwZTogXCJ3YWtlLXNjaGVkdWxlZC1lcnJvclwiXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHNhZmUgdmFsaWRhdGlvbiBmYWlsdXJlcyBhbmQgcmVwb3J0cyB1bmV4cGVjdGVkIGNsaWVudCBtdXRhdGlvbnMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuY29udGV4dCAtIEZyYW1ld29yay1lcnJvciBjb250ZXh0LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmVycm9yIC0gTXV0YXRpb24gZmFpbHVyZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZmFsbGJhY2tNZXNzYWdlIC0gQ2xpZW50LXNhZmUgZmFsbGJhY2sgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLmpzb25Tb2NrZXQgLSBKU09OIHNvY2tldC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubG9nTWVzc2FnZSAtIEVycm9yIGxvZyBwcmVmaXguXG4gICAqIEBwYXJhbSB7XCJlbnF1ZXVlLWVycm9yXCIgfCBcInJlcGxhY2Utc2NoZWR1bGVkLWVycm9yXCIgfCBcImNhbmNlbC1zY2hlZHVsZWQtZXJyb3JcIiB8IFwiZ2V0LXNjaGVkdWxlZC1qb2ItZXJyb3JcIiB8IFwid2FrZS1zY2hlZHVsZWQtZXJyb3JcIn0gYXJncy5yZXNwb25zZVR5cGUgLSBSZXNwb25zZSB0eXBlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9oYW5kbGVDbGllbnRNdXRhdGlvbkVycm9yKHtjb250ZXh0LCBlcnJvciwgZmFsbGJhY2tNZXNzYWdlLCBqc29uU29ja2V0LCBsb2dNZXNzYWdlLCByZXNwb25zZVR5cGV9KSB7XG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgVmVsb2Npb3VzRXJyb3IgJiYgZXJyb3Iuc2FmZVRvRXhwb3NlKSB7XG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IHJlc3BvbnNlVHlwZSwgZXJyb3I6IGVycm9yLm1lc3NhZ2V9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG4gICAgY29uc3QgcGF5bG9hZCA9IHtjb250ZXh0LCBlcnJvcjogbm9ybWFsaXplZEVycm9yfVxuICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtsb2dNZXNzYWdlLCBub3JtYWxpemVkRXJyb3JdKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogcmVzcG9uc2VUeXBlLCBlcnJvcjogZmFsbGJhY2tNZXNzYWdlfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBqb2IgY29tcGxldGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLmpzb25Tb2NrZXQgLSBKU09OIHNvY2tldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JDb21wbGV0ZU1lc3NhZ2V9IGFyZ3MubWVzc2FnZSAtIE1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gaGFuZGxlZC5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVKb2JDb21wbGV0ZSh7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgYWNjZXB0ZWQgPSBhd2FpdCB0aGlzLnN0b3JlLm1hcmtDb21wbGV0ZWQoe1xuICAgICAgICBqb2JJZDogbWVzc2FnZS5qb2JJZCxcbiAgICAgICAgaGFuZG9mZklkOiBtZXNzYWdlLmhhbmRvZmZJZCxcbiAgICAgICAgd29ya2VySWQ6IG1lc3NhZ2Uud29ya2VySWQsXG4gICAgICAgIGhhbmRlZE9mZkF0TXM6IG1lc3NhZ2UuaGFuZGVkT2ZmQXRNc1xuICAgICAgfSlcbiAgICAgIGlmIChhY2NlcHRlZCAmJiBtZXNzYWdlLmhhbmRvZmZJZCkge1xuICAgICAgICB0aGlzLl9mb3JnZXRIYW5kb2ZmKHtoYW5kb2ZmSWQ6IG1lc3NhZ2UuaGFuZG9mZklkLCBqb2JJZDogbWVzc2FnZS5qb2JJZH0pXG4gICAgICB9XG4gICAgICB0aGlzLm9uSm9iVXBkYXRlZD8uKHthY2NlcHRlZCwgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsIHN0YXR1czogXCJjb21wbGV0ZWRcIn0pXG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiam9iLXVwZGF0ZWRcIiwgam9iSWQ6IG1lc3NhZ2Uuam9iSWR9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLl9yZXBvcnRKb2JVcGRhdGVGYWlsdXJlKHtlcnJvciwgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsIHN0YWdlOiBcImJhY2tncm91bmQtam9iLWNvbXBsZXRlXCJ9KVxuICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImpvYi11cGRhdGUtZXJyb3JcIiwgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsIGVycm9yOiBcIkZhaWxlZCB0byB1cGRhdGUgam9iXCJ9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTdXJmYWNlcyBhbiB1bmV4cGVjdGVkIGR1cmFibGUgcmVwb3J0IGZhaWx1cmUgd2l0aG91dCBleHBvc2luZyBpdCB0byB0aGVcbiAgICogcmVwb3J0aW5nIHBlZXIuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRmFpbHVyZSBjb250ZXh0LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmVycm9yIC0gQWRhcHRlciBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIER1cmFibGUgam9iIGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zdGFnZSAtIE11dGF0aW9uIHN0YWdlLlxuICAgKi9cbiAgX3JlcG9ydEpvYlVwZGF0ZUZhaWx1cmUoe2Vycm9yLCBqb2JJZCwgc3RhZ2V9KSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG4gICAgY29uc3QgcGF5bG9hZCA9IHtjb250ZXh0OiB7Z2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZCwgam9iSWQsIHN0YWdlfSwgZXJyb3I6IG5vcm1hbGl6ZWRFcnJvcn1cbiAgICBjb25zdCBlcnJvckV2ZW50cyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpXG5cbiAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJGYWlsZWQgdG8gdXBkYXRlIGJhY2tncm91bmQgam9iOlwiLCBub3JtYWxpemVkRXJyb3JdKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuICB9XG5cbiAgLyoqXG4gICAqIFBlcnNpc3RzIGEgbm9ybWFsIGpvYiByZXNjaGVkdWxlIG91dGNvbWUgYW5kIHdha2VzIHNjaGVkdWxlZCBkaXNwYXRjaC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJlc2NoZWR1bGVNZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBNZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGhhbmRsZWQuXG4gICAqL1xuICBhc3luYyBfaGFuZGxlSm9iUmVzY2hlZHVsZSh7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgYWNjZXB0ZWQgPSBhd2FpdCB0aGlzLnN0b3JlLm1hcmtSZXNjaGVkdWxlZCh7XG4gICAgICAgIGpvYklkOiBtZXNzYWdlLmpvYklkLFxuICAgICAgICBkZWxheU1zOiBtZXNzYWdlLmRlbGF5TXMsXG4gICAgICAgIGhhbmRvZmZJZDogbWVzc2FnZS5oYW5kb2ZmSWQsXG4gICAgICAgIHdvcmtlcklkOiBtZXNzYWdlLndvcmtlcklkLFxuICAgICAgICBoYW5kZWRPZmZBdE1zOiBtZXNzYWdlLmhhbmRlZE9mZkF0TXNcbiAgICAgIH0pXG4gICAgICBpZiAoYWNjZXB0ZWQgJiYgbWVzc2FnZS5oYW5kb2ZmSWQpIHtcbiAgICAgICAgdGhpcy5fZm9yZ2V0SGFuZG9mZih7aGFuZG9mZklkOiBtZXNzYWdlLmhhbmRvZmZJZCwgam9iSWQ6IG1lc3NhZ2Uuam9iSWR9KVxuICAgICAgfVxuICAgICAgdGhpcy5vbkpvYlVwZGF0ZWQ/Lih7YWNjZXB0ZWQsIGpvYklkOiBtZXNzYWdlLmpvYklkLCBzdGF0dXM6IFwicmVzY2hlZHVsZWRcIn0pXG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiam9iLXVwZGF0ZWRcIiwgam9iSWQ6IG1lc3NhZ2Uuam9iSWR9KVxuICAgICAgdGhpcy5fbm90aWZ5RW5xdWV1ZWQoKVxuICAgICAgYXdhaXQgdGhpcy5fZHJhaW4oKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICAgIGNvbnN0IHBheWxvYWQgPSB7Y29udGV4dDoge2pvYklkOiBtZXNzYWdlLmpvYklkLCBzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi1yZXNjaGVkdWxlXCJ9LCBlcnJvcjogbm9ybWFsaXplZEVycm9yfVxuICAgICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJGYWlsZWQgdG8gdXBkYXRlIGpvYiByZXNjaGVkdWxlOlwiLCBub3JtYWxpemVkRXJyb3JdKVxuICAgICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgICAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4ucGF5bG9hZCwgZXJyb3JUeXBlOiBcImZyYW1ld29yay1lcnJvclwifSlcbiAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJqb2ItdXBkYXRlLWVycm9yXCIsIGpvYklkOiBtZXNzYWdlLmpvYklkLCBlcnJvcjogXCJGYWlsZWQgdG8gdXBkYXRlIGpvYlwifSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgam9iIGZhaWxlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkZhaWxlZE1lc3NhZ2V9IGFyZ3MubWVzc2FnZSAtIE1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gaGFuZGxlZC5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVKb2JGYWlsZWQoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGZhaWxlZEpvYiA9IGF3YWl0IHRoaXMuc3RvcmUubWFya0ZhaWxlZCh7XG4gICAgICAgIGpvYklkOiBtZXNzYWdlLmpvYklkLFxuICAgICAgICBlcnJvcjogbWVzc2FnZS5lcnJvcixcbiAgICAgICAgaGFuZG9mZklkOiBtZXNzYWdlLmhhbmRvZmZJZCxcbiAgICAgICAgd29ya2VySWQ6IG1lc3NhZ2Uud29ya2VySWQsXG4gICAgICAgIGhhbmRlZE9mZkF0TXM6IG1lc3NhZ2UuaGFuZGVkT2ZmQXRNc1xuICAgICAgfSlcblxuICAgICAgaWYgKGZhaWxlZEpvYikge1xuICAgICAgICBpZiAobWVzc2FnZS5oYW5kb2ZmSWQpIHtcbiAgICAgICAgICB0aGlzLl9mb3JnZXRIYW5kb2ZmKHtoYW5kb2ZmSWQ6IG1lc3NhZ2UuaGFuZG9mZklkLCBqb2JJZDogbWVzc2FnZS5qb2JJZH0pXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fZW1pdEJhY2tncm91bmRKb2JGYWlsZWQoe1xuICAgICAgICAgIGVycm9yOiBtZXNzYWdlLmVycm9yLFxuICAgICAgICAgIGhhbmRvZmZJZDogbWVzc2FnZS5oYW5kb2ZmSWQsXG4gICAgICAgICAgaGFuZGVkT2ZmQXRNczogbWVzc2FnZS5oYW5kZWRPZmZBdE1zLFxuICAgICAgICAgIGpvYjogZmFpbGVkSm9iLFxuICAgICAgICAgIHJ1bm5lckZhaWx1cmU6IG1lc3NhZ2UucnVubmVyRmFpbHVyZSxcbiAgICAgICAgICB3b3JrZXJJZDogbWVzc2FnZS53b3JrZXJJZFxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICB0aGlzLm9uSm9iVXBkYXRlZD8uKHthY2NlcHRlZDogQm9vbGVhbihmYWlsZWRKb2IpLCBqb2JJZDogbWVzc2FnZS5qb2JJZCwgc3RhdHVzOiBcImZhaWxlZFwifSlcbiAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJqb2ItdXBkYXRlZFwiLCBqb2JJZDogbWVzc2FnZS5qb2JJZH0pXG4gICAgICAvLyBBIGZhaWxlZCBqb2IgbWF5IGhhdmUgYmVlbiByZS1xdWV1ZWQgKHdpdGggYmFja29mZikgZm9yIHJldHJ5IOKAlFxuICAgICAgLy8gcG9rZSB0aGUgZGlzcGF0Y2hlciBzbyB0aGUgcmV0cnkgdGltZXIgaXMgYXJtZWQuXG4gICAgICB0aGlzLl9ub3RpZnlFbnF1ZXVlZCgpXG4gICAgICBhd2FpdCB0aGlzLl9kcmFpbigpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIkZhaWxlZCB0byB1cGRhdGUgam9iIGZhaWx1cmU6XCIsIGVycm9yXSlcbiAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJqb2ItdXBkYXRlLWVycm9yXCIsIGpvYklkOiBtZXNzYWdlLmpvYklkLCBlcnJvcjogXCJGYWlsZWQgdG8gdXBkYXRlIGpvYlwifSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbWl0IGJhY2tncm91bmQgam9iIGZhaWxlZC5cbiAgICogQHBhcmFtIHt7ZXJyb3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBoYW5kb2ZmSWQ/OiBzdHJpbmcsIGhhbmRlZE9mZkF0TXM/OiBudW1iZXIsIGpvYjogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93LCBydW5uZXJGYWlsdXJlPzogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRSdW5uZXJGYWlsdXJlLCB3b3JrZXJJZD86IHN0cmluZ319IGFyZ3MgLSBGYWlsdXJlIGV2ZW50IGRhdGEuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2VtaXRCYWNrZ3JvdW5kSm9iRmFpbGVkKHtlcnJvciwgaGFuZG9mZklkLCBoYW5kZWRPZmZBdE1zLCBqb2IsIHJ1bm5lckZhaWx1cmUsIHdvcmtlcklkfSkge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IHRoaXMuX25vcm1hbGl6ZUZhaWx1cmVFcnJvcihlcnJvcilcbiAgICBjb25zdCBwYXlsb2FkID0ge1xuICAgICAgY29udGV4dDoge1xuICAgICAgICBhdHRlbXB0czogam9iLmF0dGVtcHRzLFxuICAgICAgICBoYW5kb2ZmSWQsXG4gICAgICAgIGhhbmRlZE9mZkF0TXMsXG4gICAgICAgIGpvYkFyZ3M6IGpvYi5hcmdzLFxuICAgICAgICBqb2JJZDogam9iLmlkLFxuICAgICAgICBqb2JOYW1lOiBqb2Iuam9iTmFtZSxcbiAgICAgICAgbWF4UmV0cmllczogam9iLm1heFJldHJpZXMsXG4gICAgICAgIHJ1bm5lckZhaWx1cmUsXG4gICAgICAgIHN0YWdlOiBcImJhY2tncm91bmQtam9iLWZhaWxlZFwiLFxuICAgICAgICBzdGF0dXM6IGpvYi5zdGF0dXMsXG4gICAgICAgIHRlcm1pbmFsOiBqb2Iuc3RhdHVzID09PSBcImZhaWxlZFwiIHx8IGpvYi5zdGF0dXMgPT09IFwib3JwaGFuZWRcIixcbiAgICAgICAgd2lsbFJldHJ5OiBqb2Iuc3RhdHVzID09PSBcInF1ZXVlZFwiLFxuICAgICAgICB3b3JrZXJJZFxuICAgICAgfSxcbiAgICAgIGVycm9yOiBub3JtYWxpemVkRXJyb3JcbiAgICB9XG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImJhY2tncm91bmQtam9iLWZhaWxlZFwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJiYWNrZ3JvdW5kLWpvYi1mYWlsZWRcIn0pXG4gIH1cblxuICAvKipcbiAgICogRW1pdHMgYGJhY2tncm91bmQtam9iLW9ycGhhbmVkYCAobWlycm9yZWQgdG8gYGFsbC1lcnJvcmApIGZvciBhIGpvYiB0aGUgdGltZS1iYXNlZCBvcnBoYW4gc3dlZXBcbiAgICogcmVjbGFpbWVkIGFmdGVyIGl0cyB3b3JrZXIgZGllZCBtaWQtcnVuLiBVbmxpa2UgYGJhY2tncm91bmQtam9iLWZhaWxlZGAsIHdoaWNoIGZpcmVzIG9uIGFcbiAgICogd29ya2VyJ3MgZmFpbHVyZSByZXBvcnQsIHRoaXMgZmlyZXMgZnJvbSB0aGUgbWFpbiBwcm9jZXNzJ3Mgc3dlZXAsIHNvIGFwcGxpY2F0aW9ucyBjYW4gcmVhY3QgdG9cbiAgICogYSBkZWFkIHdvcmtlcidzIHNwZWNpZmljIGpvYiDigJQgcmVjb3ZlciB0aGUgd29yayBpdCBsZWZ0IGJlaGluZCDigJQgd2l0aG91dCBwb2xsaW5nLiBgd2lsbFJldHJ5YFxuICAgKiByZWZsZWN0cyB3aGV0aGVyIHRoZSByZWNsYWltIHJldHVybmVkIHRoZSBqb2IgdG8gdGhlIHF1ZXVlIGZvciBhbm90aGVyIGF0dGVtcHQuXG4gICAqIEBwYXJhbSB7e2pvYjogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fX0gYXJncyAtIFRoZSBvcnBoYW5lZCBqb2IuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2VtaXRCYWNrZ3JvdW5kSm9iT3JwaGFuZWQoe2pvYn0pIHtcbiAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSB0aGlzLl9ub3JtYWxpemVGYWlsdXJlRXJyb3Ioam9iLmxhc3RFcnJvciA/PyBcIkpvYiBvcnBoYW5lZCBhZnRlciB0aW1lb3V0XCIpXG4gICAgY29uc3QgcGF5bG9hZCA9IHtcbiAgICAgIGNvbnRleHQ6IHtcbiAgICAgICAgYXR0ZW1wdHM6IGpvYi5hdHRlbXB0cyxcbiAgICAgICAgam9iQXJnczogam9iLmFyZ3MsXG4gICAgICAgIGpvYklkOiBqb2IuaWQsXG4gICAgICAgIGpvYk5hbWU6IGpvYi5qb2JOYW1lLFxuICAgICAgICBtYXhSZXRyaWVzOiBqb2IubWF4UmV0cmllcyxcbiAgICAgICAgc3RhZ2U6IFwiYmFja2dyb3VuZC1qb2Itb3JwaGFuZWRcIixcbiAgICAgICAgc3RhdHVzOiBqb2Iuc3RhdHVzLFxuICAgICAgICB0ZXJtaW5hbDogam9iLnN0YXR1cyA9PT0gXCJmYWlsZWRcIiB8fCBqb2Iuc3RhdHVzID09PSBcIm9ycGhhbmVkXCIsXG4gICAgICAgIHdpbGxSZXRyeTogam9iLnN0YXR1cyA9PT0gXCJxdWV1ZWRcIlxuICAgICAgfSxcbiAgICAgIGVycm9yOiBub3JtYWxpemVkRXJyb3JcbiAgICB9XG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImJhY2tncm91bmQtam9iLW9ycGhhbmVkXCIsIHBheWxvYWQpXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4ucGF5bG9hZCwgZXJyb3JUeXBlOiBcImJhY2tncm91bmQtam9iLW9ycGhhbmVkXCJ9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGZhaWx1cmUgZXJyb3IuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gUmVwb3J0ZWQgZmFpbHVyZSB2YWx1ZS5cbiAgICogQHJldHVybnMge0Vycm9yfSBOb3JtYWxpemVkIGVycm9yLlxuICAgKi9cbiAgX25vcm1hbGl6ZUZhaWx1cmVFcnJvcihlcnJvcikge1xuICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yKSByZXR1cm4gZXJyb3JcblxuICAgIHJldHVybiB0aGlzLl9lcnJvckZyb21Vbmtub3duRmFpbHVyZShlcnJvcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVycm9yIGZyb20gdW5rbm93biBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBlcnJvciAtIFJlcG9ydGVkIGZhaWx1cmUgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtFcnJvcn0gTm9ybWFsaXplZCBlcnJvci5cbiAgICovXG4gIF9lcnJvckZyb21Vbmtub3duRmFpbHVyZShlcnJvcikge1xuICAgIGNvbnN0IG1lc3NhZ2UgPSB0aGlzLl9tZXNzYWdlRnJvbVVua25vd25GYWlsdXJlKGVycm9yKVxuICAgIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IG5ldyBFcnJvcihtZXNzYWdlKVxuXG4gICAgdGhpcy5fY29weVN0cmluZ0ZhaWx1cmVTdGFjayh7ZXJyb3IsIG5vcm1hbGl6ZWRFcnJvcn0pXG5cbiAgICByZXR1cm4gbm9ybWFsaXplZEVycm9yXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtZXNzYWdlIGZyb20gdW5rbm93biBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBlcnJvciAtIFJlcG9ydGVkIGZhaWx1cmUgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IEVycm9yIG1lc3NhZ2UuXG4gICAqL1xuICBfbWVzc2FnZUZyb21Vbmtub3duRmFpbHVyZShlcnJvcikge1xuICAgIGlmICh0aGlzLl9oYXNTdHJpbmdGYWlsdXJlKGVycm9yKSkgcmV0dXJuIGVycm9yLnRyaW0oKS5zcGxpdChcIlxcblwiKVswXVxuXG4gICAgcmV0dXJuIFN0cmluZyhlcnJvciB8fCBcIkJhY2tncm91bmQgam9iIGZhaWxlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFzIHN0cmluZyBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBlcnJvciAtIFJlcG9ydGVkIGZhaWx1cmUgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtlcnJvciBpcyBzdHJpbmd9IFdoZXRoZXIgdGhlIHZhbHVlIGlzIGEgbm9uLWVtcHR5IHN0cmluZy5cbiAgICovXG4gIF9oYXNTdHJpbmdGYWlsdXJlKGVycm9yKSB7XG4gICAgcmV0dXJuIHR5cGVvZiBlcnJvciA9PT0gXCJzdHJpbmdcIiAmJiBlcnJvci50cmltKCkubGVuZ3RoID4gMFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29weSBzdHJpbmcgZmFpbHVyZSBzdGFjay5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmVycm9yIC0gUmVwb3J0ZWQgZmFpbHVyZSB2YWx1ZS5cbiAgICogQHBhcmFtIHtFcnJvcn0gYXJncy5ub3JtYWxpemVkRXJyb3IgLSBOb3JtYWxpemVkIGVycm9yLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9jb3B5U3RyaW5nRmFpbHVyZVN0YWNrKHtlcnJvciwgbm9ybWFsaXplZEVycm9yfSkge1xuICAgIGlmICh0aGlzLl9oYXNTdHJpbmdGYWlsdXJlKGVycm9yKSkgbm9ybWFsaXplZEVycm9yLnN0YWNrID0gZXJyb3JcbiAgfVxuXG4gIC8qKlxuICAgKiBEcmFpbnMgYWxsIGRpc3BhdGNoYWJsZSBqb2JzIHRvIHJlYWR5IHdvcmtlcnMsIHRoZW4gYXJtcyB0aGVcbiAgICogc2NoZWR1bGVkLWpvYiB0aW1lciBmb3IgdGhlIG5leHQgZnV0dXJlIGBzY2hlZHVsZWRfYXRfbXNgLiBDb2FsZXNjZXNcbiAgICogY29uY3VycmVudCB0cmlnZ2VyczogYSB3YWtlLXVwIHRoYXQgbGFuZHMgd2hpbGUgYSBkcmFpbiBpcyBpblxuICAgKiBmbGlnaHQganVzdCBzZXRzIGEgcmUtZHJhaW4gZmxhZyBhbmQgbGV0cyB0aGUgaW4tZmxpZ2h0IGRyYWluXG4gICAqIHJlLWxvb3AgYWZ0ZXIgaXQgZmluaXNoZXMsIHNvIG5vIHNpZ25hbCBpcyBkcm9wcGVkIGJ1dCBubyB0d29cbiAgICogZHJhaW5zIHJ1biBpbiBwYXJhbGxlbC5cbiAgICpcbiAgICogUmVzaWxpZW5jZTogaW4gYmVhY29uIG1vZGUgdGhpcyBpcyB0aGUgc29sZSB3YWtlLXVwIHBhdGggZm9yXG4gICAqIGFscmVhZHktcXVldWVkIHdvcmssIHNvIGEgdHJhbnNpZW50IERCIGVycm9yIGR1cmluZyB0aGUgZHJhaW4gKGUuZy5cbiAgICogYG5leHRBdmFpbGFibGVKb2IoKWAgcmVqZWN0aW5nKSBtdXN0IG5vdCBzdHJhbmQgdGhlIHF1ZXVlIHVudGlsIHRoZVxuICAgKiBuZXh0IGV4dGVybmFsIHNpZ25hbC4gT24gYW55IGVycm9yIHdlIGxvZyBpdCBhbmQgYXJtIGEgb25lLXNob3RcbiAgICogcmV0cnkgdmlhIGBfc2NoZWR1bGVFcnJvclJldHJ5YCB1c2luZyBgcG9sbEludGVydmFsTXNgIGFzIHRoZVxuICAgKiBjYWRlbmNlOyBvbiBzdWNjZXNzIHRoZSByZXRyeSB0aW1lciBpcyBjbGVhcmVkLiBQb2xsaW5nLW1vZGUgcnVuc1xuICAgKiBgX2RyYWluYCBmcm9tIGl0cyBvd24gaW50ZXJ2YWwsIHNvIHRoZSByZXRyeSB0aW1lciBpcyBhIG5vLW9wIHRoZXJlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9kcmFpbigpIHtcbiAgICBpZiAodGhpcy5fc3RvcHBlZCB8fCB0aGlzLmxpZmVjeWNsZVN0YXRlICE9PSBcImFjdGl2ZVwiIHx8ICF0aGlzLl9hY3RpdmVPd25lcnNoaXBSZWFkeSkgcmV0dXJuXG5cbiAgICBpZiAodGhpcy5fZHJhaW5Qcm9taXNlKSB7XG4gICAgICB0aGlzLl9yZWRyYWluUXVldWVkID0gdHJ1ZVxuICAgICAgYXdhaXQgdGhpcy5fZHJhaW5Qcm9taXNlXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBkcmFpblByb21pc2UgPSB0aGlzLl9kcmFpblRvQ29tcGxldGlvbigpXG5cbiAgICB0aGlzLl9kcmFpblByb21pc2UgPSBkcmFpblByb21pc2VcbiAgICBhd2FpdCBkcmFpblByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9uZSBzZXJpYWxpemVkIGRyYWluIGxpZmVjeWNsZSwgaW5jbHVkaW5nIHRpbWVyIHJlLWFybWluZy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZXZlcnkgY29hbGVzY2VkIHJlcXVlc3QgaXMgaGFuZGxlZC5cbiAgICovXG4gIGFzeW5jIF9kcmFpblRvQ29tcGxldGlvbigpIHtcbiAgICB0aGlzLl9kcmFpbmluZyA9IHRydWVcblxuICAgIHRyeSB7XG4gICAgICBsZXQgZXJyb3JlZFxuXG4gICAgICBkbyB7XG4gICAgICAgIGVycm9yZWQgPSBhd2FpdCB0aGlzLl9kcmFpblVudGlsSWRsZSgpXG4gICAgICAgIGF3YWl0IHRoaXMuX2ZpbmlzaERyYWluKHtlcnJvcmVkfSlcbiAgICAgIH0gd2hpbGUgKCFlcnJvcmVkICYmIHRoaXMuX3JlZHJhaW5RdWV1ZWQgJiYgIXRoaXMuX3N0b3BwZWQgJiYgdGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJhY3RpdmVcIilcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5fZHJhaW5pbmcgPSBmYWxzZVxuICAgICAgdGhpcy5fZHJhaW5Qcm9taXNlID0gdW5kZWZpbmVkXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluaXNoIGRyYWluLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5lcnJvcmVkIC0gV2hldGhlciB0aGUgZHJhaW4gaGl0IGFuIGVycm9yLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBmb2xsb3ctdXAgdGltZXJzIGFyZSBoYW5kbGVkLlxuICAgKi9cbiAgYXN5bmMgX2ZpbmlzaERyYWluKHtlcnJvcmVkfSkge1xuICAgIGlmICh0aGlzLl9zdG9wcGVkIHx8IHRoaXMubGlmZWN5Y2xlU3RhdGUgIT09IFwiYWN0aXZlXCIpIHJldHVyblxuICAgIGlmIChlcnJvcmVkKSByZXR1cm4gdGhpcy5fc2NoZWR1bGVFcnJvclJldHJ5KClcblxuICAgIGF3YWl0IHRoaXMuX2FybVNjaGVkdWxlZFRpbWVyT3JSZXRyeSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcm0gc2NoZWR1bGVkIHRpbWVyIG9yIHJldHJ5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBzY2hlZHVsZWQgdGltZXIgaGFuZGxpbmcuXG4gICAqL1xuICBhc3luYyBfYXJtU2NoZWR1bGVkVGltZXJPclJldHJ5KCkge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl9hcm1TY2hlZHVsZWRUaW1lcigpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIkJhY2tncm91bmQgam9icyBzY2hlZHVsZWQtdGltZXIgYXJtaW5nIGZhaWxlZDpcIiwgZXJyb3JdKVxuICAgICAgdGhpcy5fc2NoZWR1bGVFcnJvclJldHJ5KClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuX2NsZWFyRXJyb3JSZXRyeVRpbWVyKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsZWFyIGVycm9yIHJldHJ5IHRpbWVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gKi9cbiAgX2NsZWFyRXJyb3JSZXRyeVRpbWVyKCkge1xuICAgIGlmICh0aGlzLnBlbmRpbmdIYW5kb2ZmUmVjb3Zlcmllcy5zaXplID4gMCkgcmV0dXJuXG4gICAgaWYgKHRoaXMuX3N0YXJ0dXBIYW5kb2ZmR3JhY2VFbGFwc2VkICYmIHRoaXMuc3RhcnR1cEhhbmRvZmZTbmFwc2hvdC5sZW5ndGggPiAwKSByZXR1cm5cblxuICAgIGZvciAoY29uc3Qgd29ya2VyIG9mIHRoaXMud29ya2VySGFuZG9mZnMua2V5cygpKSB7XG4gICAgICBpZiAoIXRoaXMud29ya2Vycy5oYXMod29ya2VyKSkgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX2Vycm9yUmV0cnlUaW1lcikge1xuICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuX2Vycm9yUmV0cnlUaW1lcilcbiAgICAgIHRoaXMuX2Vycm9yUmV0cnlUaW1lciA9IHVuZGVmaW5lZFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRyYWluIHVudGlsIGlkbGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGRyYWluIGhpdCBhbiBlcnJvci5cbiAgICovXG4gIGFzeW5jIF9kcmFpblVudGlsSWRsZSgpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fcnVuRHJhaW5Mb29wKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biBkcmFpbiBsb29wLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBkcmFpbiBoaXQgYW4gZXJyb3IuXG4gICAqL1xuICBhc3luYyBfcnVuRHJhaW5Mb29wKCkge1xuICAgIGRvIHtcbiAgICAgIHRoaXMuX3JlZHJhaW5RdWV1ZWQgPSBmYWxzZVxuICAgICAgY29uc3QgZXJyb3JlZCA9IGF3YWl0IHRoaXMuX2RyYWluT25jZVdpdGhFcnJvclJlcG9ydCgpXG5cbiAgICAgIGlmIChlcnJvcmVkKSByZXR1cm4gdHJ1ZVxuICAgIH0gd2hpbGUgKHRoaXMuX3JlZHJhaW5RdWV1ZWQgJiYgIXRoaXMuX3N0b3BwZWQpXG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRyYWluIG9uY2Ugd2l0aCBlcnJvciByZXBvcnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgb25lIGRyYWluIHBhc3MgZmFpbGVkLlxuICAgKi9cbiAgYXN5bmMgX2RyYWluT25jZVdpdGhFcnJvclJlcG9ydCgpIHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fZHJhaW5PbmNlKClcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJCYWNrZ3JvdW5kIGpvYnMgZHJhaW4gZmFpbGVkOlwiLCBlcnJvcl0pXG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBUaW1lb3V0RXJyb3IpIHRoaXMuX3JlcG9ydERyYWluU3RhbGxFcnJvcihlcnJvcilcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEJvdW5kcyBvbmUgZHJhaW4tY3JpdGljYWwgc3RvcmUgb3BlcmF0aW9uIHNvIGEgc3RvcmUgY2FsbCB0aGF0IG5ldmVyXG4gICAqIHNldHRsZXMgcmVqZWN0cyBpbnRvIHRoZSBkcmFpbiBlcnJvci9yZXRyeSBwYXRoIGluc3RlYWQgb2Ygc3RhbGxpbmcgdGhlXG4gICAqIGNvYWxlc2NlZCBkcmFpbiBhbmQgZXZlcnkgbGF0ZXIgZGlzcGF0Y2ggcXVldWVkIGJlaGluZCBpdC5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtzdHJpbmd9IG9wZXJhdGlvbiAtIE9wZXJhdGlvbiBsYWJlbCBmb3IgdGhlIHRpbWVvdXQgZXJyb3IuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBEcmFpbiBzdG9yZSBvcGVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIE9wZXJhdGlvbiByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfYm91bmRlZERyYWluU3RvcmVPcGVyYXRpb24ob3BlcmF0aW9uLCBjYWxsYmFjaykge1xuICAgIHJldHVybiBhd2FpdCB0aW1lb3V0KHtcbiAgICAgIGVycm9yTWVzc2FnZTogYEJhY2tncm91bmQgam9icyBkcmFpbiBzdG9yZSBvcGVyYXRpb24gdGltZWQgb3V0IGFmdGVyICR7dGhpcy5kcmFpblN0b3JlT3BlcmF0aW9uVGltZW91dE1zfW1zOiAke29wZXJhdGlvbn1gLFxuICAgICAgdGltZW91dDogdGhpcy5kcmFpblN0b3JlT3BlcmF0aW9uVGltZW91dE1zXG4gICAgfSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogU3VyZmFjZXMgYSBkcmFpbiBwYXNzIHdob3NlIHN0b3JlIG9wZXJhdGlvbiBuZXZlciBzZXR0bGVkLiBUaGUgYm91bmRlZFxuICAgKiBzdG9yZSB0aW1lb3V0IGtlZXBzIGRpc3BhdGNoIG1vdmluZyB0aHJvdWdoIHRoZSBlcnJvci1yZXRyeSBwYXRoOyB0aGlzXG4gICAqIHJlcG9ydCBtYWtlcyB0aGUgc3RhbGwgb2JzZXJ2YWJsZSBmb3IgcHJvY2Vzcy1sZXZlbCBidWcgcmVwb3J0ZXJzLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBlcnJvciAtIERyYWluIHN0YWxsIGZhaWx1cmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlcG9ydERyYWluU3RhbGxFcnJvcihlcnJvcikge1xuICAgIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgICBjb250ZXh0OiB7XG4gICAgICAgIHN0YWdlOiBcImJhY2tncm91bmQtam9icy1kcmFpbi1zdGFsbFwiLFxuICAgICAgICBkcmFpblN0b3JlT3BlcmF0aW9uVGltZW91dE1zOiB0aGlzLmRyYWluU3RvcmVPcGVyYXRpb25UaW1lb3V0TXMsXG4gICAgICAgIGRpc3BhdGNoU3RyYXRlZ3k6IHRoaXMuZGlzcGF0Y2hTdHJhdGVneVxuICAgICAgfSxcbiAgICAgIGVycm9yXG4gICAgfVxuICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuICB9XG5cbiAgLyoqXG4gICAqIEFybXMgYSBvbmUtc2hvdCBgc2V0VGltZW91dGAgdG8gcmV0cnkgYF9kcmFpbmAgYWZ0ZXIgYSB0cmFuc2llbnRcbiAgICogZmFpbHVyZS4gSWRlbXBvdGVudCDigJQgcmVwZWF0ZWQgY2FsbHMgd2hpbGUgYSByZXRyeSBpcyBhbHJlYWR5XG4gICAqIHBlbmRpbmcgYXJlIG5vLW9wcy4gUG9sbGluZyBtb2RlIGFscmVhZHkgcmV0cmllcyB2aWEgaXRzIG93blxuICAgKiBpbnRlcnZhbCwgc28gdGhpcyBpcyBhIG5vLW9wIGluIHRoYXQgbW9kZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2NoZWR1bGVFcnJvclJldHJ5KCkge1xuICAgIGlmICh0aGlzLl9zdG9wcGVkKSByZXR1cm5cbiAgICBpZiAodGhpcy5fZXJyb3JSZXRyeVRpbWVyKSByZXR1cm5cbiAgICBpZiAodGhpcy5kaXNwYXRjaFN0cmF0ZWd5ID09PSBcInBvbGxpbmdcIiAmJiB0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcImFjdGl2ZVwiKSByZXR1cm5cblxuICAgIHRoaXMuX2Vycm9yUmV0cnlUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdGhpcy5fZXJyb3JSZXRyeVRpbWVyID0gdW5kZWZpbmVkXG4gICAgICB2b2lkIHRoaXMuX3JldHJ5QWZ0ZXJFcnJvcigpXG4gICAgfSwgdGhpcy5wb2xsSW50ZXJ2YWxNcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXRyaWVzIGZhaWxlZCBwcmUtZGlzcGF0Y2ggYW5kIGRpc2Nvbm5lY3RlZC1zb2NrZXQgcmVsZWFzZXMgYmVmb3JlXG4gICAqIGRyYWluaW5nIHF1ZXVlZCB3b3JrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciByZXRyeSB3b3JrLlxuICAgKi9cbiAgYXN5bmMgX3JldHJ5QWZ0ZXJFcnJvcigpIHtcbiAgICBpZiAodGhpcy5fc3RvcHBlZCkgcmV0dXJuXG5cbiAgICBpZiAodGhpcy5fc3RhcnR1cEhhbmRvZmZHcmFjZUVsYXBzZWQgJiYgdGhpcy5zdGFydHVwSGFuZG9mZlNuYXBzaG90Lmxlbmd0aCA+IDApIHtcbiAgICAgIGF3YWl0IHRoaXMuX3N0YXJ0U3RhcnR1cEhhbmRvZmZSZWNsYWltKClcbiAgICAgIGlmICh0aGlzLnN0YXJ0dXBIYW5kb2ZmU25hcHNob3QubGVuZ3RoID4gMCkgcmV0dXJuXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX3JldHJ5UGVuZGluZ0hhbmRvZmZSZWNvdmVyaWVzKClcbiAgICB9IGNhdGNoIHtcbiAgICAgIHRoaXMuX3NjaGVkdWxlRXJyb3JSZXRyeSgpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgZm9yIChjb25zdCB3b3JrZXIgb2YgdGhpcy53b3JrZXJIYW5kb2Zmcy5rZXlzKCkpIHtcbiAgICAgICAgaWYgKCF0aGlzLndvcmtlcnMuaGFzKHdvcmtlcikpIGF3YWl0IHRoaXMuX3JlbGVhc2VXb3JrZXJIYW5kb2Zmcyh3b3JrZXIpXG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuX3JlcG9ydEhhbmRvZmZSZWxlYXNlRXJyb3IoZXJyb3IpXG4gICAgICB0aGlzLl9zY2hlZHVsZUVycm9yUmV0cnkoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwiYWN0aXZlXCIpIGF3YWl0IHRoaXMuX2RyYWluKClcbiAgICB0aGlzLl9tYXliZVN0b3BSZXRpcmVkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBJbm5lciBkcmFpbiBsb29wOiBwdWxscyBlbGlnaWJsZSBxdWV1ZWQgam9icyBhbmQgaGFuZHMgdGhlbSBvZmYgdG9cbiAgICogcmVhZHkgd29ya2VycyB1bnRpbCBvbmUgb2YgdGhlbSBydW5zIG91dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfZHJhaW5PbmNlKCkge1xuICAgIHdoaWxlICh0aGlzLnJlYWR5V29ya2Vycy5zaXplID4gMCAmJiAhdGhpcy5fc3RvcHBlZCAmJiB0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcImFjdGl2ZVwiICYmIHRoaXMuX2FjdGl2ZU93bmVyc2hpcFJlYWR5KSB7XG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9ib3VuZGVkRHJhaW5TdG9yZU9wZXJhdGlvbihcIm5leHQtYXZhaWxhYmxlLWpvYlwiLCBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLm5leHRBdmFpbGFibGVKb2JGb3JSZWFkeVdvcmtlcnMoKSlcbiAgICAgIGlmICgham9iKSByZXR1cm5cblxuICAgICAgY29uc3Qgd29ya2VyID0gdGhpcy5yZWFkeVdvcmtlckZvckpvYihqb2IpXG4gICAgICBpZiAoIXdvcmtlcikgcmV0dXJuXG5cbiAgICAgIGNvbnN0IGFkbWlzc2lvbiA9IHRoaXMuX2NvbnN1bWVXb3JrZXJBZG1pc3Npb24oe2pvYiwgd29ya2VyfSlcbiAgICAgIGNvbnN0IHJlcXVlc3RlZEhhbmRvZmZJZCA9IHJhbmRvbVVVSUQoKVxuICAgICAgbGV0IGhhbmRvZmZcblxuICAgICAgdHJ5IHtcbiAgICAgICAgaGFuZG9mZiA9IGF3YWl0IHRoaXMuX2JvdW5kZWREcmFpblN0b3JlT3BlcmF0aW9uKFwibWFyay1oYW5kZWQtb2ZmXCIsIGFzeW5jICgpID0+IGF3YWl0IHRoaXMuc3RvcmUubWFya0hhbmRlZE9mZih7aGFuZG9mZklkOiByZXF1ZXN0ZWRIYW5kb2ZmSWQsIGpvYklkOiBqb2IuaWQsIHdvcmtlcklkOiB3b3JrZXIud29ya2VySWR9KSlcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRoaXMuX3JlbWVtYmVySGFuZG9mZlJlY292ZXJ5KHtoYW5kb2ZmSWQ6IHJlcXVlc3RlZEhhbmRvZmZJZCwgam9iSWQ6IGpvYi5pZH0pXG4gICAgICAgIHRoaXMuX3Jlc3RvcmVXb3JrZXJBZG1pc3Npb24oey4uLmFkbWlzc2lvbiwgd29ya2VyfSlcblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IHRoaXMuX2JvdW5kZWREcmFpblN0b3JlT3BlcmF0aW9uKFwicmVjb3Zlci1oYW5kb2ZmXCIsIGFzeW5jICgpID0+IGF3YWl0IHRoaXMuX3JlY292ZXJIYW5kb2ZmKHtoYW5kb2ZmSWQ6IHJlcXVlc3RlZEhhbmRvZmZJZCwgam9iSWQ6IGpvYi5pZH0pKVxuICAgICAgICB9IGNhdGNoIChyZWNvdmVyeUVycm9yKSB7XG4gICAgICAgICAgdGhpcy5fcmVwb3J0SGFuZG9mZlJlY292ZXJ5RXJyb3Ioe2Vycm9yOiByZWNvdmVyeUVycm9yLCBoYW5kb2ZmSWQ6IHJlcXVlc3RlZEhhbmRvZmZJZCwgam9iSWQ6IGpvYi5pZH0pXG4gICAgICAgIH1cblxuICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgfVxuXG4gICAgICBpZiAoIWhhbmRvZmYpIHtcbiAgICAgICAgdGhpcy5fcmVzdG9yZVdvcmtlckFkbWlzc2lvbih7Li4uYWRtaXNzaW9uLCB3b3JrZXJ9KVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLmFmdGVySGFuZG9mZkNsYWltPy4oe2hhbmRvZmYsIGpvYn0pXG5cbiAgICAgIGNvbnN0IGhhbmRvZmZzID0gdGhpcy53b3JrZXJIYW5kb2Zmcy5nZXQod29ya2VyKVxuXG4gICAgICBpZiAoIWhhbmRvZmZzIHx8ICF0aGlzLndvcmtlcnMuaGFzKHdvcmtlcikgfHwgd29ya2VyLmlzRHJhaW5pbmcgfHwgdGhpcy5saWZlY3ljbGVTdGF0ZSAhPT0gXCJhY3RpdmVcIiB8fCAhdGhpcy5fYWN0aXZlT3duZXJzaGlwUmVhZHkpIHtcbiAgICAgICAgdGhpcy5fcmVtZW1iZXJIYW5kb2ZmUmVjb3Zlcnkoe2hhbmRvZmZJZDogaGFuZG9mZi5oYW5kb2ZmSWQsIGpvYklkOiBqb2IuaWR9KVxuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IHRoaXMuX2JvdW5kZWREcmFpblN0b3JlT3BlcmF0aW9uKFwicmVjb3Zlci1oYW5kb2ZmXCIsIGFzeW5jICgpID0+IGF3YWl0IHRoaXMuX3JlY292ZXJIYW5kb2ZmKHtoYW5kb2ZmSWQ6IGhhbmRvZmYuaGFuZG9mZklkLCBqb2JJZDogam9iLmlkfSkpXG4gICAgICAgIH0gY2F0Y2ggKHJlY292ZXJ5RXJyb3IpIHtcbiAgICAgICAgICB0aGlzLl9yZXBvcnRIYW5kb2ZmUmVjb3ZlcnlFcnJvcih7ZXJyb3I6IHJlY292ZXJ5RXJyb3IsIGhhbmRvZmZJZDogaGFuZG9mZi5oYW5kb2ZmSWQsIGpvYklkOiBqb2IuaWR9KVxuICAgICAgICAgIHRocm93IHJlY292ZXJ5RXJyb3JcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9ub3RpZnlFbnF1ZXVlZCgpXG4gICAgICAgIHRoaXMuX3JlZHJhaW5RdWV1ZWQgPSB0cnVlXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIHRoaXMuX2ZpbmFsaXplV29ya2VyQWRtaXNzaW9uKHsuLi5hZG1pc3Npb24sIGpvYiwgd29ya2VyfSlcbiAgICAgIGhhbmRvZmZzLnNldChqb2IuaWQsIGhhbmRvZmYuaGFuZG9mZklkKVxuXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBkaXNwYXRjaGVkSm9iID0gaGFuZG9mZi5qb2IgfHwgam9iXG5cbiAgICAgICAgd29ya2VyLnNlbmQoe1xuICAgICAgICAgIHR5cGU6IFwiam9iXCIsXG4gICAgICAgICAgcGF5bG9hZDoge1xuICAgICAgICAgICAgaWQ6IGRpc3BhdGNoZWRKb2IuaWQsXG4gICAgICAgICAgICBqb2JOYW1lOiBkaXNwYXRjaGVkSm9iLmpvYk5hbWUsXG4gICAgICAgICAgICBhcmdzOiBkaXNwYXRjaGVkSm9iLmFyZ3MsXG4gICAgICAgICAgICBoYW5kb2ZmSWQ6IGhhbmRvZmYuaGFuZG9mZklkLFxuICAgICAgICAgICAgd29ya2VySWQ6IHdvcmtlci53b3JrZXJJZCxcbiAgICAgICAgICAgIGhhbmRlZE9mZkF0TXM6IGhhbmRvZmYuaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgICAgIG9wdGlvbnM6IHtcbiAgICAgICAgICAgICAgY29uY3VycmVuY3lLZXk6IGRpc3BhdGNoZWRKb2IuY29uY3VycmVuY3lLZXkgfHwgdW5kZWZpbmVkLFxuICAgICAgICAgICAgICBleGVjdXRpb25Nb2RlOiBkaXNwYXRjaGVkSm9iLmV4ZWN1dGlvbk1vZGUsXG4gICAgICAgICAgICAgIG1heENvbmN1cnJlbmN5OiBkaXNwYXRjaGVkSm9iLm1heENvbmN1cnJlbmN5ID8/IHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgbWF4UmV0cmllczogZGlzcGF0Y2hlZEpvYi5tYXhSZXRyaWVzID8/IHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgcXVldWU6IGRpc3BhdGNoZWRKb2IucXVldWUsXG4gICAgICAgICAgICAgIHNjaGVkdWxlZEF0TXM6IGRpc3BhdGNoZWRKb2Iuc2NoZWR1bGVkQXRNcyA/PyB1bmRlZmluZWQsXG4gICAgICAgICAgICAgIC4uLihkaXNwYXRjaGVkSm9iLnRpbWVvdXRNcyA9PT0gbnVsbCA/IHt9IDoge3RpbWVvdXRNczogZGlzcGF0Y2hlZEpvYi50aW1lb3V0TXN9KVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLndhcm4oKCkgPT4gW1wiRmFpbGVkIHRvIHNlbmQgam9iIHRvIHdvcmtlciwgcmUtcXVldWVpbmc6XCIsIGVycm9yXSlcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICB3b3JrZXIuY2xvc2UoKVxuICAgICAgICB9IGNhdGNoIChjbG9zZUVycm9yKSB7XG4gICAgICAgICAgdGhpcy5sb2dnZXIud2FybigoKSA9PiBbXCJGYWlsZWQgdG8gY2xvc2Ugd29ya2VyIGFmdGVyIGpvYiBzZW5kIGZhaWx1cmU6XCIsIGNsb3NlRXJyb3JdKVxuICAgICAgICB9XG4gICAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZVdvcmtlclNvY2tldENsb3NlZCh3b3JrZXIsIHtxdWV1ZVJlZHJhaW46IHRydWV9KVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDb25zdW1lcyBvbmUgYWR2ZXJ0aXNlZCB3b3JrZXIgYWRtaXNzaW9uIHdoaWxlIHBlcnNpc3RlbmNlIGlzIGluIGZsaWdodC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBZG1pc3Npb24gZGV0YWlscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGFyZ3Muam9iIC0gU2VsZWN0ZWQgam9iLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3Mud29ya2VyIC0gU2VsZWN0ZWQgd29ya2VyIHNvY2tldC5cbiAgICogQHJldHVybnMge3twb29sZWRDcmVkaXRDb25zdW1lZDogYm9vbGVhbiwgcmVhZGluZXNzVmVyc2lvbjogbnVtYmVyfX0gLSBSZXZlcnNpYmxlIGFkbWlzc2lvbiBkZWJpdC5cbiAgICovXG4gIF9jb25zdW1lV29ya2VyQWRtaXNzaW9uKHtqb2IsIHdvcmtlcn0pIHtcbiAgICBsZXQgcG9vbGVkQ3JlZGl0Q29uc3VtZWQgPSBmYWxzZVxuXG4gICAgdGhpcy5yZWFkeVdvcmtlcnMuZGVsZXRlKHdvcmtlcilcblxuICAgIGlmIChqb2IuZXhlY3V0aW9uTW9kZSA9PT0gXCJwb29sZWRcIiAmJiB3b3JrZXIudXNlc1Bvb2xlZENhcGFjaXR5Q3JlZGl0cyAmJiB3b3JrZXIuYXZhaWxhYmxlUG9vbGVkU2xvdHMgPiAwKSB7XG4gICAgICBwb29sZWRDcmVkaXRDb25zdW1lZCA9IHRydWVcbiAgICAgIHdvcmtlci5hdmFpbGFibGVQb29sZWRTbG90cyAtPSAxXG4gICAgICBpZiAod29ya2VyLmF2YWlsYWJsZVBvb2xlZFNsb3RzID4gMCkgdGhpcy5yZWFkeVdvcmtlcnMuYWRkKHdvcmtlcilcbiAgICB9XG5cbiAgICByZXR1cm4ge3Bvb2xlZENyZWRpdENvbnN1bWVkLCByZWFkaW5lc3NWZXJzaW9uOiB3b3JrZXIucmVhZGluZXNzVmVyc2lvbn1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXN0b3JlcyBhbiBhZG1pc3Npb24gdGhhdCBuZXZlciByZWFjaGVkIGEgd29ya2VyLiBBIG5ld2VyIHJlYWRpbmVzc1xuICAgKiBhZHZlcnRpc2VtZW50IGlzIGFscmVhZHkgYXV0aG9yaXRhdGl2ZSwgc28gaXRzIHBvb2xlZCBjb3VudCBpcyBub3QgY2hhbmdlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBZG1pc3Npb24gZGV0YWlscy5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLnBvb2xlZENyZWRpdENvbnN1bWVkIC0gV2hldGhlciBhIHBvb2xlZCBjcmVkaXQgd2FzIGRlYml0ZWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLnJlYWRpbmVzc1ZlcnNpb24gLSBSZWFkaW5lc3MgZ2VuZXJhdGlvbiBhdCBkZWJpdCB0aW1lLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3Mud29ya2VyIC0gU2VsZWN0ZWQgd29ya2VyIHNvY2tldC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVzdG9yZVdvcmtlckFkbWlzc2lvbih7cG9vbGVkQ3JlZGl0Q29uc3VtZWQsIHJlYWRpbmVzc1ZlcnNpb24sIHdvcmtlcn0pIHtcbiAgICBpZiAodGhpcy5fc3RvcHBlZCB8fCB0aGlzLmxpZmVjeWNsZVN0YXRlICE9PSBcImFjdGl2ZVwiIHx8ICF0aGlzLl9hY3RpdmVPd25lcnNoaXBSZWFkeSB8fCAhdGhpcy53b3JrZXJzLmhhcyh3b3JrZXIpIHx8IHdvcmtlci5pc0RyYWluaW5nKSByZXR1cm5cblxuICAgIGlmIChwb29sZWRDcmVkaXRDb25zdW1lZCAmJiB3b3JrZXIucmVhZGluZXNzVmVyc2lvbiA9PT0gcmVhZGluZXNzVmVyc2lvbikge1xuICAgICAgd29ya2VyLmF2YWlsYWJsZVBvb2xlZFNsb3RzICs9IDFcbiAgICB9XG5cbiAgICBpZiAod29ya2VyLnN1cHBvcnRzSGFuZG9mZklkUmVwb3J0aW5nKSB0aGlzLnJlYWR5V29ya2Vycy5hZGQod29ya2VyKVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgYSBzdWNjZXNzZnVsIHBvb2xlZCBhZG1pc3Npb24gdG8gYSByZWFkaW5lc3MgYWR2ZXJ0aXNlbWVudCB0aGF0XG4gICAqIGFycml2ZWQgd2hpbGUgcGVyc2lzdGVuY2Ugd2FzIGluIGZsaWdodCBhbmQgcmVwbGFjZWQgdGhlIGVhcmxpZXIgZGViaXQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQWRtaXNzaW9uIGRldGFpbHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBhcmdzLmpvYiAtIFNlbGVjdGVkIGpvYi5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLnBvb2xlZENyZWRpdENvbnN1bWVkIC0gV2hldGhlciBhIHBvb2xlZCBjcmVkaXQgd2FzIGRlYml0ZWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLnJlYWRpbmVzc1ZlcnNpb24gLSBSZWFkaW5lc3MgZ2VuZXJhdGlvbiBhdCBkZWJpdCB0aW1lLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3Mud29ya2VyIC0gU2VsZWN0ZWQgd29ya2VyIHNvY2tldC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfZmluYWxpemVXb3JrZXJBZG1pc3Npb24oe2pvYiwgcG9vbGVkQ3JlZGl0Q29uc3VtZWQsIHJlYWRpbmVzc1ZlcnNpb24sIHdvcmtlcn0pIHtcbiAgICBpZiAoIXBvb2xlZENyZWRpdENvbnN1bWVkIHx8IGpvYi5leGVjdXRpb25Nb2RlICE9PSBcInBvb2xlZFwiKSByZXR1cm5cbiAgICBpZiAod29ya2VyLnJlYWRpbmVzc1ZlcnNpb24gPT09IHJlYWRpbmVzc1ZlcnNpb24gfHwgIXdvcmtlci51c2VzUG9vbGVkQ2FwYWNpdHlDcmVkaXRzKSByZXR1cm5cbiAgICBpZiAod29ya2VyLmF2YWlsYWJsZVBvb2xlZFNsb3RzIDw9IDApIHJldHVyblxuXG4gICAgd29ya2VyLmF2YWlsYWJsZVBvb2xlZFNsb3RzIC09IDFcbiAgICBpZiAod29ya2VyLmF2YWlsYWJsZVBvb2xlZFNsb3RzID09PSAwKSB0aGlzLnJlYWR5V29ya2Vycy5kZWxldGUod29ya2VyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldGFpbnMgYW4gZXhhY3QgbGVhc2UgZm9yIGlkZW1wb3RlbnQgcHJlLWRpc3BhdGNoIHJlY292ZXJ5LlxuICAgKiBAcGFyYW0ge3toYW5kb2ZmSWQ6IHN0cmluZywgam9iSWQ6IHN0cmluZ319IGFyZ3MgLSBFeGFjdCByZWNvdmVyeSBmZW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVtZW1iZXJIYW5kb2ZmUmVjb3Zlcnkoe2hhbmRvZmZJZCwgam9iSWR9KSB7XG4gICAgdGhpcy5wZW5kaW5nSGFuZG9mZlJlY292ZXJpZXMuc2V0KGhhbmRvZmZJZCwgam9iSWQpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBvbmUgZXhhY3QgbGVhc2UgYW5kIGZvcmdldHMgaXQgb25seSBhZnRlciB0aGUgYWRhcHRlciBhY2tub3dsZWRnZXNcbiAgICogdGhlIGZlbmNlZCB0cmFuc2l0aW9uIG9yIGNvbmZpcm1zIGl0IHdhcyBhbHJlYWR5IGFic2VudC5cbiAgICogQHBhcmFtIHt7aGFuZG9mZklkOiBzdHJpbmcsIGpvYklkOiBzdHJpbmd9fSBhcmdzIC0gRXhhY3QgcmVjb3ZlcnkgZmVuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGR1cmFibGUgcmVjb3Zlcnkgc2V0dGxlcy5cbiAgICovXG4gIGFzeW5jIF9yZWNvdmVySGFuZG9mZih7aGFuZG9mZklkLCBqb2JJZH0pIHtcbiAgICBhd2FpdCB0aGlzLnN0b3JlLm1hcmtSZXR1cm5lZFRvUXVldWUoe2hhbmRvZmZJZCwgam9iSWR9KVxuXG4gICAgaWYgKHRoaXMucGVuZGluZ0hhbmRvZmZSZWNvdmVyaWVzLmdldChoYW5kb2ZmSWQpID09PSBqb2JJZCkge1xuICAgICAgdGhpcy5wZW5kaW5nSGFuZG9mZlJlY292ZXJpZXMuZGVsZXRlKGhhbmRvZmZJZClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVwbGF5cyByZXRhaW5lZCBleGFjdC1JRCByZWNvdmVyaWVzIHRocm91Z2ggdGhlIGRpc3BhdGNoZXIncyBleGlzdGluZ1xuICAgKiB0cmFuc2llbnQtZXJyb3IgcmV0cnkgbGlmZWN5Y2xlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBldmVyeSByZXRhaW5lZCByZWNvdmVyeSBzZXR0bGVzLlxuICAgKi9cbiAgYXN5bmMgX3JldHJ5UGVuZGluZ0hhbmRvZmZSZWNvdmVyaWVzKCkge1xuICAgIGZvciAoY29uc3QgW2hhbmRvZmZJZCwgam9iSWRdIG9mIFsuLi50aGlzLnBlbmRpbmdIYW5kb2ZmUmVjb3Zlcmllc10pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3JlY292ZXJIYW5kb2ZmKHtoYW5kb2ZmSWQsIGpvYklkfSlcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRoaXMuX3JlcG9ydEhhbmRvZmZSZWNvdmVyeUVycm9yKHtlcnJvciwgaGFuZG9mZklkLCBqb2JJZH0pXG4gICAgICAgIHRocm93IGVycm9yXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFN1cmZhY2VzIGEgZmFpbGVkIGV4YWN0LUlEIHJlY292ZXJ5IHdpdGhvdXQgZHJvcHBpbmcgaXRzIHJldHJ5IGxlZGdlciBlbnRyeS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBSZWNvdmVyeSBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmVycm9yIC0gQWRhcHRlciBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5oYW5kb2ZmSWQgLSBFeGFjdCBsZWFzZSBmZW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlcG9ydEhhbmRvZmZSZWNvdmVyeUVycm9yKHtlcnJvciwgaGFuZG9mZklkLCBqb2JJZH0pIHtcbiAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICBjb25zdCBwYXlsb2FkID0ge1xuICAgICAgY29udGV4dDoge2hhbmRvZmZJZCwgam9iSWQsIHN0YWdlOiBcImJhY2tncm91bmQtam9iLWhhbmRvZmYtYWRtaXNzaW9uLXJlY292ZXJ5XCJ9LFxuICAgICAgZXJyb3I6IG5vcm1hbGl6ZWRFcnJvclxuICAgIH1cbiAgICBjb25zdCBlcnJvckV2ZW50cyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpXG5cbiAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJGYWlsZWQgdG8gcmVjb3ZlciBhbiBhbWJpZ3VvdXMgYmFja2dyb3VuZCBqb2IgaGFuZG9mZjpcIiwgbm9ybWFsaXplZEVycm9yXSlcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiZnJhbWV3b3JrLWVycm9yXCIsIHBheWxvYWQpXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4ucGF5bG9hZCwgZXJyb3JUeXBlOiBcImZyYW1ld29yay1lcnJvclwifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5leHQgYXZhaWxhYmxlIGpvYiBmb3IgcmVhZHkgd29ya2Vycy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gTmV4dCBxdWV1ZWQgam9iIG1hdGNoaW5nIHJlYWR5IHdvcmtlciBjYXBhY2l0eS5cbiAgICovXG4gIGFzeW5jIG5leHRBdmFpbGFibGVKb2JGb3JSZWFkeVdvcmtlcnMoKSB7XG4gICAgY29uc3QgZXhlY3V0aW9uTW9kZXMgPSB0aGlzLnJlYWR5V29ya2VyRXhlY3V0aW9uTW9kZXMoKVxuXG4gICAgaWYgKGV4ZWN1dGlvbk1vZGVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGxcbiAgICBpZiAoZXhlY3V0aW9uTW9kZXMubGVuZ3RoID09PSBXT1JLRVJfRVhFQ1VUSU9OX01PREVfQ0FQQUJJTElUSUVTLmxlbmd0aCkgcmV0dXJuIGF3YWl0IHRoaXMuc3RvcmUubmV4dEF2YWlsYWJsZUpvYigpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5zdG9yZS5uZXh0QXZhaWxhYmxlSm9iKHtleGVjdXRpb25Nb2RlOiBleGVjdXRpb25Nb2Rlc30pXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWFkeSB3b3JrZXIgZXhlY3V0aW9uIG1vZGVzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZVtdfSAtIEV4ZWN1dGlvbiBtb2RlcyBjdXJyZW50bHkgYWNjZXB0ZWQgYnkgcmVhZHkgd29ya2Vycy5cbiAgICovXG4gIHJlYWR5V29ya2VyRXhlY3V0aW9uTW9kZXMoKSB7XG4gICAgY29uc3QgZXhlY3V0aW9uTW9kZXMgPSBuZXcgU2V0KClcblxuICAgIGZvciAoY29uc3Qgd29ya2VyIG9mIHRoaXMucmVhZHlXb3JrZXJzKSB7XG4gICAgICB0aGlzLl9hZGRBY2NlcHRlZEV4ZWN1dGlvbk1vZGVzKHtleGVjdXRpb25Nb2Rlcywgd29ya2VyfSlcbiAgICB9XG5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlW119ICovIChbLi4uZXhlY3V0aW9uTW9kZXNdKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRkIGFjY2VwdGVkIGV4ZWN1dGlvbiBtb2Rlcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge1NldDxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlPn0gYXJncy5leGVjdXRpb25Nb2RlcyAtIEFjY2VwdGVkIG1vZGVzLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3Mud29ya2VyIC0gV29ya2VyIHNvY2tldC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfYWRkQWNjZXB0ZWRFeGVjdXRpb25Nb2Rlcyh7ZXhlY3V0aW9uTW9kZXMsIHdvcmtlcn0pIHtcbiAgICBpZiAoIXdvcmtlci5zdXBwb3J0c0hhbmRvZmZJZFJlcG9ydGluZykgcmV0dXJuXG5cbiAgICBmb3IgKGNvbnN0IGNhcGFiaWxpdHkgb2YgV09SS0VSX0VYRUNVVElPTl9NT0RFX0NBUEFCSUxJVElFUykge1xuICAgICAgaWYgKGNhcGFiaWxpdHkuYWNjZXB0cyh3b3JrZXIpKSBleGVjdXRpb25Nb2Rlcy5hZGQoY2FwYWJpbGl0eS5leGVjdXRpb25Nb2RlKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlYWR5IHdvcmtlciBmb3Igam9iLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gam9iIC0gSm9iIGJlaW5nIGhhbmRlZCBvZmYuXG4gICAqIEByZXR1cm5zIHtKc29uU29ja2V0IHwgdW5kZWZpbmVkfSAtIFJlYWR5IHdvcmtlciBmb3IgdGhlIGpvYiB0eXBlLlxuICAgKi9cbiAgcmVhZHlXb3JrZXJGb3JKb2Ioam9iKSB7XG4gICAgZm9yIChjb25zdCB3b3JrZXIgb2YgdGhpcy5yZWFkeVdvcmtlcnMpIHtcbiAgICAgIGlmICh0aGlzLl93b3JrZXJBY2NlcHRzSm9iKHtqb2IsIHdvcmtlcn0pKSByZXR1cm4gd29ya2VyXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd29ya2VyIGFjY2VwdHMgam9iLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBhcmdzLmpvYiAtIEpvYiBiZWluZyBoYW5kZWQgb2ZmLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3Mud29ya2VyIC0gV29ya2VyIHNvY2tldC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgd29ya2VyIGFjY2VwdHMgdGhlIGpvYiBtb2RlLlxuICAgKi9cbiAgX3dvcmtlckFjY2VwdHNKb2Ioe2pvYiwgd29ya2VyfSkge1xuICAgIGlmICghd29ya2VyLnN1cHBvcnRzSGFuZG9mZklkUmVwb3J0aW5nKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IGNhcGFiaWxpdHkgPSBXT1JLRVJfRVhFQ1VUSU9OX01PREVfQ0FQQUJJTElUSUVTX0JZX01PREUuZ2V0KGpvYi5leGVjdXRpb25Nb2RlKVxuXG4gICAgaWYgKCFjYXBhYmlsaXR5KSByZXR1cm4gZmFsc2VcblxuICAgIHJldHVybiBjYXBhYmlsaXR5LmFjY2VwdHMod29ya2VyKVxuICB9XG5cbiAgLyoqXG4gICAqIEFybXMgYSBzaW5nbGUgYHNldFRpbWVvdXRgIGZvciB0aGUgc29vbmVzdCBmdXR1cmUtc2NoZWR1bGVkIGpvYidzXG4gICAqIGBzY2hlZHVsZWRfYXRfbXNgLiBSZXBsYWNlcyB0aGUgc2Vjb25kIHJlc3BvbnNpYmlsaXR5IG9mIHRoZSBsZWdhY3lcbiAgICogMS1zZWNvbmQgcG9sbCAoYmVjb21pbmctZWxpZ2libGUgc2NoZWR1bGVkIGpvYnMpLiBUaGUgdGltZXIgaXNcbiAgICogaWRlbXBvdGVudGx5IHJlLWFybWVkIGF0IHRoZSBlbmQgb2YgZXZlcnkgZHJhaW4uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2FybVNjaGVkdWxlZFRpbWVyKCkge1xuICAgIGlmICh0aGlzLl9zY2hlZHVsZWRUaW1lcikge1xuICAgICAgdGhpcy5jbG9jay5jbGVhclRpbWVvdXQodGhpcy5fc2NoZWR1bGVkVGltZXIpXG4gICAgICB0aGlzLl9zY2hlZHVsZWRUaW1lciA9IHVuZGVmaW5lZFxuICAgIH1cblxuICAgIGlmICh0aGlzLl9zdG9wcGVkIHx8IHRoaXMubGlmZWN5Y2xlU3RhdGUgIT09IFwiYWN0aXZlXCIgfHwgIXRoaXMuX2FjdGl2ZU93bmVyc2hpcFJlYWR5KSByZXR1cm5cbiAgICBpZiAodGhpcy5kaXNwYXRjaFN0cmF0ZWd5ID09PSBcInBvbGxpbmdcIikgcmV0dXJuXG5cbiAgICBjb25zdCBuZXh0ID0gYXdhaXQgdGhpcy5zdG9yZS5uZXh0U2NoZWR1bGVkSm9iKClcbiAgICBsZXQgZGVsYXlcblxuICAgIGlmIChuZXh0ICYmIHR5cGVvZiBuZXh0LnNjaGVkdWxlZEF0TXMgPT09IFwibnVtYmVyXCIpIHtcbiAgICAgIGRlbGF5ID0gTWF0aC5tYXgoMCwgTWF0aC5taW4obmV4dC5zY2hlZHVsZWRBdE1zIC0gdGhpcy5jbG9jay5ub3coKSwgTUFYX1RJTUVSX01TKSlcbiAgICB9XG5cbiAgICAvLyBgbmV4dFNjaGVkdWxlZEpvYmAgb25seSByZXR1cm5zIGZ1dHVyZSBqb2JzLCBzbyBhIGpvYiB0aGF0IGJlY2FtZVxuICAgIC8vIGVsaWdpYmxlIGFmdGVyIHRoZSBkcmFpbidzIGVsaWdpYmxlLWpvYiBwcm9iZSBpcyBpbnZpc2libGUgdG8gaXQuIElmIG9uZVxuICAgIC8vIGlzIGRpc3BhdGNoYWJsZSBub3csIGFybSBhIDAtZGVsYXkgcmUtZHJhaW4gc28gaXQgaXMgZGlzcGF0Y2hlZFxuICAgIC8vIGltbWVkaWF0ZWx5IGluc3RlYWQgb2YgYmVpbmcgc3RyYW5kZWQgdW50aWwgdGhlIG5leHQgZnV0dXJlIHRpbWVyIChvclxuICAgIC8vIGV4dGVybmFsIHNpZ25hbCkgZmlyZXMuXG4gICAgaWYgKGF3YWl0IHRoaXMubmV4dEF2YWlsYWJsZUpvYkZvclJlYWR5V29ya2VycygpKSBkZWxheSA9IDBcblxuICAgIGlmICh0eXBlb2YgZGVsYXkgIT09IFwibnVtYmVyXCIpIHJldHVyblxuXG4gICAgdGhpcy5fc2NoZWR1bGVkVGltZXIgPSB0aGlzLmNsb2NrLnNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdGhpcy5fc2NoZWR1bGVkVGltZXIgPSB1bmRlZmluZWRcbiAgICAgIHZvaWQgdGhpcy5fZHJhaW4oKVxuICAgIH0sIGRlbGF5KVxuICB9XG5cbiAgYXN5bmMgX3N3ZWVwT3JwaGFucygpIHtcbiAgICB0cnkge1xuICAgICAgbGV0IG9ycGhhbmVkSm9ic1xuXG4gICAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQpIHtcbiAgICAgICAgY29uc3QgY29ubmVjdGVkV29ya2VySWRzID0gbmV3IFNldCgpXG4gICAgICAgIGZvciAoY29uc3Qgd29ya2VyIG9mIHRoaXMud29ya2Vycykge1xuICAgICAgICAgIGlmICh3b3JrZXIud29ya2VySWQpIGNvbm5lY3RlZFdvcmtlcklkcy5hZGQod29ya2VyLndvcmtlcklkKVxuICAgICAgICB9XG4gICAgICAgIGZvciAoY29uc3Qgd29ya2VySWQgb2YgdGhpcy5kaXNjb25uZWN0ZWRXb3JrZXJzLmtleXMoKSkgY29ubmVjdGVkV29ya2VySWRzLmFkZCh3b3JrZXJJZClcblxuICAgICAgICBjb25zdCBjdXRvZmYgPSB0aGlzLmNsb2NrLm5vdygpIC0gR0VORVJBVElPTl9PUlBIQU5FRF9BRlRFUl9NU1xuICAgICAgICBjb25zdCBoYW5kb2ZmcyA9IChhd2FpdCB0aGlzLl9nZW5lcmF0aW9uT3duZWRIYW5kb2ZmU25hcHNob3QoKSkuZmlsdGVyKChoYW5kb2ZmKSA9PiB7XG4gICAgICAgICAgcmV0dXJuIGhhbmRvZmYuaGFuZGVkT2ZmQXRNcyA8PSBjdXRvZmYgJiYgIWNvbm5lY3RlZFdvcmtlcklkcy5oYXMoaGFuZG9mZi53b3JrZXJJZClcbiAgICAgICAgfSlcbiAgICAgICAgb3JwaGFuZWRKb2JzID0gaGFuZG9mZnMubGVuZ3RoID09PSAwXG4gICAgICAgICAgPyBbXVxuICAgICAgICAgIDogYXdhaXQgdGhpcy5zdG9yZS5tYXJrT3JwaGFuZWRIYW5kb2Zmcyh7aGFuZG9mZnMsIGVycm9yOiBcIkpvYiBvcnBoYW5lZCBhZnRlciBpdHMgZ2VuZXJhdGlvbiBvd25lciBkaXNhcHBlYXJlZFwifSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG9ycGhhbmVkSm9icyA9IGF3YWl0IHRoaXMuc3RvcmUubWFya09ycGhhbmVkSm9icygpXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZU9ycGhhbmVkSm9icyh7am9iczogb3JwaGFuZWRKb2JzLCB3YXJuaW5nOiBcIk1hcmtlZCBvcnBoYW5lZCBiYWNrZ3JvdW5kIGpvYnNcIn0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKVxuICAgICAgY29uc3QgcGF5bG9hZCA9IHtjb250ZXh0OiB7Z2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZCwgc3RhZ2U6IFwiYmFja2dyb3VuZC1qb2Itb3JwaGFuLXN3ZWVwXCJ9LCBlcnJvcjogbm9ybWFsaXplZEVycm9yfVxuICAgICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJGYWlsZWQgdG8gbWFyayBvcnBoYW5lZCBqb2JzOlwiLCBub3JtYWxpemVkRXJyb3JdKVxuICAgICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgICAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4ucGF5bG9hZCwgZXJyb3JUeXBlOiBcImZyYW1ld29yay1lcnJvclwifSlcbiAgICB9XG5cbiAgICBpZiAodGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJhY3RpdmVcIikgYXdhaXQgdGhpcy5fcmVjb25jaWxlQWN0aXZlQ29uY3VycmVuY3koKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcGFpcnMgZHVyYWJsZSBhZG1pc3Npb24gY291bnRlcnMgb24gdGhlIGFjdGl2ZSBtYWluJ3MgbWFpbnRlbmFuY2UgY2FkZW5jZVxuICAgKiBhbmQgaW1tZWRpYXRlbHkgcmV0cmllcyBkaXNwYXRjaCB3aGVuIGNhcGFjaXR5IHdhcyByZWNvdmVyZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHJlcGFpciBhbmQgYW55IHJlc3VsdGluZyBkcmFpbi5cbiAgICovXG4gIGFzeW5jIF9yZWNvbmNpbGVBY3RpdmVDb25jdXJyZW5jeSgpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5zdG9yZS5yZWNvbmNpbGVBY3RpdmVDb25jdXJyZW5jeSgpXG5cbiAgICAgIGlmIChyZXN1bHQucmVwYWlyZWRDb3VudCA+IDApIGF3YWl0IHRoaXMuX2RyYWluKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG4gICAgICBjb25zdCBwYXlsb2FkID0ge2NvbnRleHQ6IHtnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkLCBzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi1jb25jdXJyZW5jeS1yZWNvbmNpbGlhdGlvblwifSwgZXJyb3I6IG5vcm1hbGl6ZWRFcnJvcn1cbiAgICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiRmFpbGVkIHRvIHJlY29uY2lsZSBiYWNrZ3JvdW5kIGpvYiBhY3RpdmUtY29uY3VycmVuY3kgY291bnRzOlwiLCBub3JtYWxpemVkRXJyb3JdKVxuICAgICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgICAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4ucGF5bG9hZCwgZXJyb3JUeXBlOiBcImZyYW1ld29yay1lcnJvclwifSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUHVibGlzaGVzIHRoZSBjb21tb24gcG9zdC1vcnBoYW4gbGlmZWN5Y2xlOiB3YWtlIHF1ZXVlZCByZXRyaWVzLCBlbWl0IG9uZVxuICAgKiBpc29sYXRlZCBldmVudCBwZXIgYWNjZXB0ZWQgdHJhbnNpdGlvbiwgYW5kIGRyYWluIHNvIHJlbGVhc2VkIGNvbmN1cnJlbmN5XG4gICAqIGNhbiBpbW1lZGlhdGVseSBhZG1pdCBvdGhlciB3b3JrLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93W119IGFyZ3Muam9icyAtIEFjY2VwdGVkIG9ycGhhbiB0cmFuc2l0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Mud2FybmluZyAtIExpZmVjeWNsZSBsb2cgbWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHJlc3VsdGluZyBkcmFpbi5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVPcnBoYW5lZEpvYnMoe2pvYnMsIHdhcm5pbmd9KSB7XG4gICAgaWYgKGpvYnMubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aGlzLl9tYXliZVN0b3BSZXRpcmVkKClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMubG9nZ2VyLndhcm4oKCkgPT4gW3dhcm5pbmcsIGpvYnMubGVuZ3RoXSlcbiAgICAvLyBSZWNsYWltZWQgb3JwaGFucyBjYW4gYmVjb21lIGBxdWV1ZWRgIGFnYWluIOKAlCB3YWtlIHRoZSBkaXNwYXRjaGVyIGZpcnN0XG4gICAgLy8gc28gYW4gYXBwbGljYXRpb24gZXZlbnQgaGFuZGxlciB0aGF0IHRocm93cyBiZWxvdyBjYW5ub3Qgc3RyYW5kIHRoZW0uXG4gICAgdGhpcy5fbm90aWZ5RW5xdWV1ZWQoKVxuICAgIC8vIEVtaXQgYmVmb3JlIGF3YWl0aW5nIHRoZSBkcmFpbiBzbyBhIGJsb2NrZWQgZGlzcGF0Y2hlciBjYW5ub3QgZGVsYXlcbiAgICAvLyBhcHBsaWNhdGlvbiByZWNvdmVyeS4gSXNvbGF0ZSBoYW5kbGVycyBzbyBvbmUgY2Fubm90IHN1cHByZXNzIHRoZSByZXN0LlxuICAgIGZvciAoY29uc3Qgam9iIG9mIGpvYnMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHRoaXMuX2VtaXRCYWNrZ3JvdW5kSm9iT3JwaGFuZWQoe2pvYn0pXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJBIGJhY2tncm91bmQtam9iLW9ycGhhbmVkIGV2ZW50IGhhbmRsZXIgdGhyZXc6XCIsIGVycm9yXSlcbiAgICAgIH1cbiAgICB9XG4gICAgYXdhaXQgdGhpcy5fZHJhaW4oKVxuICAgIHRoaXMuX21heWJlU3RvcFJldGlyZWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIERyb3BzIHdvcmtlcnMgdGhhdCBoYXZlIGdvbmUgc2lsZW50IHBhc3QgYHdvcmtlclN0YWxlVGltZW91dE1zYCAobm9cbiAgICogaGVhcnRiZWF0LCByZWFkeSwgb3IgcmVwb3J0KS4gQSB3ZWRnZWQgd29ya2VyIGtlZXBzIGl0cyBzb2NrZXQgb3Blbiwgc28gdGhlXG4gICAqIGBjbG9zZWAtYmFzZWQgY2xlYW51cCBuZXZlciBmaXJlcyBhbmQgaXRzIGluLWZsaWdodCBsZWFzZXMg4oCUIGFuZCB0aGUgd2hvbGVcbiAgICogcXVldWUg4oCUIHN0YXkgc3R1Y2sgdW50aWwgYSBodW1hbiBub3RpY2VzLiBSZWxlYXNpbmcgdGhlIGxvc3Qgd29ya2VyJ3NcbiAgICogbGVhc2VzIGxldHMgaXRzIGpvYnMgcnVuIGVsc2V3aGVyZSBhbmQgc3RvcHMgZGlzcGF0Y2ggdG8gaXQ7IHRoZSB3b3JrZXInc1xuICAgKiBvd24gcHJvY2VzcyBsaWZlY3ljbGUgaXMgdGhlIHN1cGVydmlzb3IncyBjb25jZXJuLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgc3dlZXAuXG4gICAqL1xuICBhc3luYyBfc3dlZXBTdGFsZVdvcmtlcnMoKSB7XG4gICAgaWYgKHRoaXMuX3N0b3BwZWQpIHJldHVyblxuXG4gICAgY29uc3QgY3V0b2ZmID0gdGhpcy5jbG9jay5ub3coKSAtIHRoaXMud29ya2VyU3RhbGVUaW1lb3V0TXNcbiAgICAvKiogQHR5cGUge0pzb25Tb2NrZXRbXX0gKi9cbiAgICBjb25zdCBzdGFsZSA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHdvcmtlciBvZiB0aGlzLndvcmtlcnMpIHtcbiAgICAgIC8vIE9ubHkgZXZpY3QgaGVhcnRiZWF0LWNhcGFibGUgd29ya2Vycy4gQSBsZWdhY3kgd29ya2VyIChlLmcuIG9uZSBmcm9tIHRoZVxuICAgICAgLy8gcHJldmlvdXMgcmVsZWFzZSBkdXJpbmcgYSByb2xsaW5nIGRlcGxveSkgbmV2ZXIgaGVhcnRiZWF0cywgc28gZXZpY3RpbmdcbiAgICAgIC8vIGl0IG9uIHNpbGVuY2Ugd291bGQgd3JvbmdseSByZWxlYXNlIHRoZSBsZWFzZXMgb2YgYSBqb2IgaXQgaXMgc3RpbGxcbiAgICAgIC8vIHJ1bm5pbmcuIEl0cyBkaXNjb25uZWN0IGlzIHN0aWxsIGhhbmRsZWQgYnkgdGhlIHNvY2tldCBgY2xvc2VgIHBhdGguXG4gICAgICBpZiAoIXdvcmtlci5zdXBwb3J0c0hlYXJ0YmVhdCkgY29udGludWVcblxuICAgICAgY29uc3QgbGFzdFNlZW5BdCA9IHR5cGVvZiB3b3JrZXIubGFzdFNlZW5BdCA9PT0gXCJudW1iZXJcIiA/IHdvcmtlci5sYXN0U2VlbkF0IDogMFxuXG4gICAgICBpZiAobGFzdFNlZW5BdCA8PSBjdXRvZmYpIHN0YWxlLnB1c2god29ya2VyKVxuICAgIH1cblxuICAgIGZvciAoY29uc3Qgd29ya2VyIG9mIHN0YWxlKSB7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKCgpID0+IFtcIkRyb3BwaW5nIHN0YWxlIGJhY2tncm91bmQgam9icyB3b3JrZXJcIiwge3dvcmtlcklkOiB3b3JrZXIud29ya2VySWQsIGxhc3RTZWVuQXQ6IHdvcmtlci5sYXN0U2VlbkF0fV0pXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIHdvcmtlci5jbG9zZSgpXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gQWxyZWFkeSBjbG9zaW5nOyB0aGUgbGVhc2UgcmVsZWFzZSBiZWxvdyBpcyB3aGF0IG1hdHRlcnMuXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZVdvcmtlclNvY2tldENsb3NlZCh3b3JrZXIpXG4gICAgfVxuICB9XG59XG4iXX0=