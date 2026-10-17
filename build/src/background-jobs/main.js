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
                runnerHostname: message.runnerHostname,
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
                childInstanceId: job.childInstanceId,
                childPid: job.childPid,
                jobArgs: job.args,
                jobId: job.id,
                jobName: job.jobName,
                maxRetries: job.maxRetries,
                runnerHostname: job.runnerHostname,
                stage: "background-job-orphaned",
                status: job.status,
                terminal: job.status === "failed" || job.status === "orphaned",
                willRetry: job.status === "queued",
                workerId: job.workerId
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9iYWNrZ3JvdW5kLWpvYnMvbWFpbi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxPQUFPLEVBQUUsRUFBRSxZQUFZLEVBQUUsTUFBTSwyQkFBMkIsQ0FBQTtBQUNqRSxPQUFPLEVBQUUsVUFBVSxFQUFFLE1BQU0sUUFBUSxDQUFBO0FBQ25DLE9BQU8sR0FBRyxNQUFNLEtBQUssQ0FBQTtBQUNyQixPQUFPLFVBQVUsTUFBTSxrQkFBa0IsQ0FBQTtBQUN6QyxPQUFPLHVCQUF1QixNQUFNLGdCQUFnQixDQUFBO0FBQ3BELE9BQU8sTUFBTSxNQUFNLGNBQWMsQ0FBQTtBQUNqQyxPQUFPLDhCQUE4QixNQUFNLDJDQUEyQyxDQUFBO0FBQ3RGLE9BQU8sY0FBYyxNQUFNLHVCQUF1QixDQUFBO0FBQ2xELE9BQU8saUJBQWlCLEVBQUUsRUFBRSxnQkFBZ0IsRUFBRSxNQUFNLGdDQUFnQyxDQUFBO0FBQ3BGLE9BQU8sRUFBRSxvQkFBb0IsRUFBRSwyQkFBMkIsRUFBRSxNQUFNLDBCQUEwQixDQUFBO0FBQzVGLE9BQU8sb0NBQW9DLE1BQU0sK0JBQStCLENBQUE7QUFFaEY7Ozs7O0dBS0c7QUFDSDs7Ozs7O0dBTUc7QUFDSCxNQUFNLGdCQUFnQixHQUFHLG9DQUFvQyxDQUFBO0FBRTdEOzs7O0dBSUc7QUFDSCxNQUFNLFlBQVksR0FBRyxhQUFhLENBQUEsQ0FBQyxhQUFhO0FBQ2hELCtFQUErRTtBQUMvRSxNQUFNLHVCQUF1QixHQUFHLEtBQUssQ0FBQTtBQUNyQyxzREFBc0Q7QUFDdEQsTUFBTSx3QkFBd0IsR0FBRyxLQUFLLENBQUE7QUFDdEMseUZBQXlGO0FBQ3pGLE1BQU0seUJBQXlCLEdBQUcsS0FBSyxDQUFBO0FBQ3ZDLE1BQU0sNEJBQTRCLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxJQUFJLENBQUE7QUFDbkQsTUFBTSx5Q0FBeUMsR0FB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QUUsQ0FBQTtZQUNoQixDQUFDO1lBQUMsTUFBTSxDQUFDO2dCQUNQLDREQUE0RDtZQUM5RCxDQUFDO1lBRUQsTUFBTSxJQUFJLENBQUMseUJBQXlCLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDOUMsQ0FBQztJQUNILENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgdGltZW91dCwgeyBUaW1lb3V0RXJyb3IgfSBmcm9tIFwiYXdhaXRlcnkvYnVpbGQvdGltZW91dC5qc1wiXG5pbXBvcnQgeyByYW5kb21VVUlEIH0gZnJvbSBcImNyeXB0b1wiXG5pbXBvcnQgbmV0IGZyb20gXCJuZXRcIlxuaW1wb3J0IEpzb25Tb2NrZXQgZnJvbSBcIi4vanNvbi1zb2NrZXQuanNcIlxuaW1wb3J0IEJhY2tncm91bmRKb2JzU2NoZWR1bGVyIGZyb20gXCIuL3NjaGVkdWxlci5qc1wiXG5pbXBvcnQgTG9nZ2VyIGZyb20gXCIuLi9sb2dnZXIuanNcIlxuaW1wb3J0IFBydW5lVGVybWluYWxCYWNrZ3JvdW5kSm9ic0pvYiBmcm9tIFwiLi4vam9icy9wcnVuZS10ZXJtaW5hbC1iYWNrZ3JvdW5kLWpvYnMuanNcIlxuaW1wb3J0IFZlbG9jaW91c0Vycm9yIGZyb20gXCIuLi92ZWxvY2lvdXMtZXJyb3IuanNcIlxuaW1wb3J0IHNodXRkb3duTGlmZWN5Y2xlLCB7IHJ1blNodXRkb3duU3RlcHMgfSBmcm9tIFwiLi4vdXRpbHMvc2h1dGRvd24tbGlmZWN5Y2xlLmpzXCJcbmltcG9ydCB7IHZhbGlkYXRlR2VuZXJhdGlvbklkLCB3b3JrZXJJZEJlbG9uZ3NUb0dlbmVyYXRpb24gfSBmcm9tIFwiLi9nZW5lcmF0aW9uLWlkZW50aXR5LmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9ic0xpZmVjeWNsZUNvbnRyb2xTZXJ2ZXIgZnJvbSBcIi4vbGlmZWN5Y2xlLWNvbnRyb2wtc2VydmVyLmpzXCJcblxuLyoqXG4gKiBXb3JrZXJFeGVjdXRpb25Nb2RlQ2FwYWJpbGl0eSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gV29ya2VyRXhlY3V0aW9uTW9kZUNhcGFiaWxpdHlcbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZX0gZXhlY3V0aW9uTW9kZSAtIEV4ZWN1dGlvbiBtb2RlLlxuICogQHByb3BlcnR5IHsod29ya2VyOiBKc29uU29ja2V0KSA9PiBib29sZWFufSBhY2NlcHRzIC0gV2hldGhlciB0aGUgd29ya2VyIGFjY2VwdHMgdGhpcyBtb2RlLlxuICovXG4vKipcbiAqIENoYW5uZWwgdXNlZCBieSBgYmFja2dyb3VuZC1qb2JzLW1haW5gIHRvIGNvb3JkaW5hdGUgZGlzcGF0Y2ggd2FrZS11cHNcbiAqIGFjcm9zcyBwcm9jZXNzZXMgdmlhIEJlYWNvbi4gV29ya2VycyBkbyBOT1Qgc3Vic2NyaWJlIHRvIHRoaXMgY2hhbm5lbFxuICog4oCUIHRoZXkgYWxyZWFkeSByZWNlaXZlIGpvYi1oYW5kb2ZmIG1lc3NhZ2VzIG9uIHRoZWlyIEpzb25Tb2NrZXQgdG9cbiAqIG1haW47IHRoaXMgY2hhbm5lbCBleGlzdHMgc28gY3Jvc3MtcHJvY2VzcyBlbnF1ZXVlcyAob3IgZnV0dXJlXG4gKiBtdWx0aS1tYWluIGRlcGxveW1lbnRzKSBjYW4gcG9rZSBhbiBpZGxlIG1haW4gdG8gZHJhaW4uXG4gKi9cbmNvbnN0IERJU1BBVENIX0NIQU5ORUwgPSBcInZlbG9jaW91cy1iYWNrZ3JvdW5kLWpvYnMtZGlzcGF0Y2hcIlxuXG4vKipcbiAqIGBzZXRUaW1lb3V0YCBpcyBpbXBsZW1lbnRlZCB3aXRoIDMyLWJpdCBzaWduZWQgZGVsYXlzIG9uIE5vZGU7IHBhc3NpbmdcbiAqIGFueXRoaW5nIGxhcmdlciBzaWxlbnRseSBjbGFtcHMgdG8gMW1zIGFuZCBmaXJlcyBpbW1lZGlhdGVseS4gQ2FwIHRoZVxuICogc2NoZWR1bGVkLWpvYiB0aW1lciBoZXJlIGFuZCByZS1hcm0gd2hlbiBpdCBleHBpcmVzLlxuICovXG5jb25zdCBNQVhfVElNRVJfTVMgPSAyXzE0N180ODNfNjQ3IC8vIH4yNC44IGRheXNcbi8qKiBBIHdvcmtlciBzaWxlbnQgKG5vIGhlYXJ0YmVhdC9yZWFkeS9yZXBvcnQpIGxvbmdlciB0aGFuIHRoaXMgaXMgZHJvcHBlZC4gKi9cbmNvbnN0IFdPUktFUl9TVEFMRV9USU1FT1VUX01TID0gNjAwMDBcbi8qKiBIb3cgb2Z0ZW4gdGhlIG1haW4gc2NhbnMgd29ya2VycyBmb3Igc3RhbGVuZXNzLiAqL1xuY29uc3QgV09SS0VSX0xJVkVORVNTX1NXRUVQX01TID0gMTUwMDBcbi8qKiBHcmFjZSBmb3Igd29ya2VycyBmcm9tIHRoZSBwcmV2aW91cyBtYWluIGdlbmVyYXRpb24gdG8gcmVjb25uZWN0IGFuZCBhZG9wdCBsZWFzZXMuICovXG5jb25zdCBXT1JLRVJfUkVDT05ORUNUX0dSQUNFX01TID0gMzAwMDBcbmNvbnN0IEdFTkVSQVRJT05fT1JQSEFORURfQUZURVJfTVMgPSA2MCAqIDYwICogMTAwMFxuY29uc3QgV09SS0VSX1JFQ09OTkVDVF9HUkFDRV9WQUxJREFUSU9OX01FU1NBR0UgPSBgd29ya2VyUmVjb25uZWN0R3JhY2VNcyBtdXN0IGJlIGFuIGludGVnZXIgYmV0d2VlbiAwIGFuZCAke01BWF9USU1FUl9NU31gXG5cbi8qKlxuICogUmVzb2x2ZXMgYSBzdGFydHVwIHJlY29ubmVjdCBncmFjZSB3aXRob3V0IGFsbG93aW5nIE5vZGUncyB0aW1lciBvdmVyZmxvdyB0b1xuICogdHVybiBhbiBpbnRlbnRpb25hbGx5IGxvbmcgZ3JhY2UgaW50byBhbiBpbW1lZGlhdGUgcmVjbGFpbS5cbiAqIEBwYXJhbSB7bnVtYmVyIHwgdW5kZWZpbmVkfSB3b3JrZXJSZWNvbm5lY3RHcmFjZU1zIC0gUmVxdWVzdGVkIHJlY29ubmVjdCBncmFjZS5cbiAqIEByZXR1cm5zIHtudW1iZXJ9IC0gVmFsaWQgdGltZXIgZGVsYXkuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZVdvcmtlclJlY29ubmVjdEdyYWNlTXMod29ya2VyUmVjb25uZWN0R3JhY2VNcykge1xuICBpZiAod29ya2VyUmVjb25uZWN0R3JhY2VNcyA9PT0gdW5kZWZpbmVkKSByZXR1cm4gV09SS0VSX1JFQ09OTkVDVF9HUkFDRV9NU1xuICBpZiAoIU51bWJlci5pc0ludGVnZXIod29ya2VyUmVjb25uZWN0R3JhY2VNcykgfHwgd29ya2VyUmVjb25uZWN0R3JhY2VNcyA8IDAgfHwgd29ya2VyUmVjb25uZWN0R3JhY2VNcyA+IE1BWF9USU1FUl9NUykge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoV09SS0VSX1JFQ09OTkVDVF9HUkFDRV9WQUxJREFUSU9OX01FU1NBR0UpXG4gIH1cblxuICByZXR1cm4gd29ya2VyUmVjb25uZWN0R3JhY2VNc1xufVxuLyoqXG4gKiBXb3JrZXIgZXhlY3V0aW9uIG1vZGUgY2FwYWJpbGl0aWVzLlxuICogQHR5cGUge1dvcmtlckV4ZWN1dGlvbk1vZGVDYXBhYmlsaXR5W119ICovXG5jb25zdCBXT1JLRVJfRVhFQ1VUSU9OX01PREVfQ0FQQUJJTElUSUVTID0gW1xuICB7ZXhlY3V0aW9uTW9kZTogXCJpbmxpbmVcIiwgYWNjZXB0czogKHdvcmtlcikgPT4gd29ya2VyLmFjY2VwdHNJbmxpbmVKb2JzICE9PSBmYWxzZX0sXG4gIHtleGVjdXRpb25Nb2RlOiBcImZvcmtlZFwiLCBhY2NlcHRzOiAod29ya2VyKSA9PiB3b3JrZXIuYWNjZXB0c0ZvcmtlZEpvYnMgIT09IGZhbHNlfSxcbiAgLy8gUG9vbGVkIGlzIG9wdC1pbjogb25seSB3b3JrZXJzIHRoYXQgZXhwbGljaXRseSBhZHZlcnRpc2UgYGFjY2VwdHNQb29sZWRgXG4gIC8vIHJlY2VpdmUgcG9vbGVkIGpvYnMuIFRoZSBgPT09IHRydWVgIChyYXRoZXIgdGhhbiBgIT09IGZhbHNlYCkgY2hlY2sga2VlcHMgYVxuICAvLyBwcmUtcG9vbGVkIHdvcmtlciDigJQgd2hpY2ggbmV2ZXIgc2VuZHMgdGhlIGZpZWxkIOKAlCBvdXQgb2YgdGhlIHBvb2xlZC1jYXBhYmxlXG4gIC8vIHNldCwgc28gdGhlIG1haW4gbmV2ZXIgZGlzcGF0Y2hlcyBhIHBvb2xlZCBqb2IgdG8gYSB3b3JrZXIgdGhhdCBjYW5ub3QgcnVuXG4gIC8vIG9uZS4gVGhpcyBpcyB0aGUgY29uc2VydmF0aXZlIGhhbGYgb2YgdGhlIGV4dGVuZGVkIHJlYWRpbmVzcyBwcm90b2NvbC5cbiAge2V4ZWN1dGlvbk1vZGU6IFwicG9vbGVkXCIsIGFjY2VwdHM6ICh3b3JrZXIpID0+IHdvcmtlci5hY2NlcHRzUG9vbGVkSm9icyA9PT0gdHJ1ZSAmJiAoIXdvcmtlci51c2VzUG9vbGVkQ2FwYWNpdHlDcmVkaXRzIHx8IHdvcmtlci5hdmFpbGFibGVQb29sZWRTbG90cyA+IDApfSxcbiAge2V4ZWN1dGlvbk1vZGU6IFwic3Bhd25lZFwiLCBhY2NlcHRzOiAod29ya2VyKSA9PiB3b3JrZXIuYWNjZXB0c1NwYXduZWRKb2JzICE9PSBmYWxzZX1cbl1cbmNvbnN0IFdPUktFUl9FWEVDVVRJT05fTU9ERV9DQVBBQklMSVRJRVNfQllfTU9ERSA9IG5ldyBNYXAoXG4gIFdPUktFUl9FWEVDVVRJT05fTU9ERV9DQVBBQklMSVRJRVMubWFwKChjYXBhYmlsaXR5KSA9PiBbY2FwYWJpbGl0eS5leGVjdXRpb25Nb2RlLCBjYXBhYmlsaXR5XSlcbilcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQmFja2dyb3VuZEpvYnNNYWluIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5ob3N0XSAtIEhvc3RuYW1lLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucG9ydF0gLSBQb3J0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZ2VuZXJhdGlvbklkXSAtIEV4cGxpY2l0IHJlbGVhc2UgZ2VuZXJhdGlvbiBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkluaXRpYWxTdGF0ZX0gW2FyZ3MuaW5pdGlhbEdlbmVyYXRpb25TdGF0ZV0gLSBFeHBsaWNpdCBnZW5lcmF0aW9uIGJvb3Qgc3RhdGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5saWZlY3ljbGVTb2NrZXRQYXRoXSAtIEV4cGxpY2l0IGxpZmVjeWNsZSBzb2NrZXQgcGF0aC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLndvcmtlclN0YWxlVGltZW91dE1zXSAtIE92ZXJyaWRlIGhvdyBsb25nIGEgc2lsZW50IHdvcmtlciBtYXkgZ28gYmVmb3JlIGJlaW5nIGRyb3BwZWQgKGRlZmF1bHQgNjAwMDBtcykuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy53b3JrZXJMaXZlbmVzc1N3ZWVwTXNdIC0gT3ZlcnJpZGUgaG93IG9mdGVuIHN0YWxlIHdvcmtlcnMgYXJlIHN3ZXB0IGZvciAoZGVmYXVsdCAxNTAwMG1zKS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLndvcmtlclJlY29ubmVjdEdyYWNlTXNdIC0gSW50ZWdlciBmcm9tIDAgdGhyb3VnaCAyLDE0Nyw0ODMsNjQ3IG92ZXJyaWRpbmcgaG93IGxvbmcgcHJldmlvdXMtZ2VuZXJhdGlvbiB3b3JrZXJzIG1heSByZWNvbm5lY3QgYmVmb3JlIGV4YWN0IHN0YXJ0dXAgbGVhc2VzIGFyZSByZWNsYWltZWQgKGRlZmF1bHQgMzAwMDBtcykuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zT25TdG9wXSAtIFdoZXRoZXIgc3RvcCBvd25zIGNsb3NpbmcgdGhlIGNvbmZpZ3VyYXRpb24ncyBkYXRhYmFzZSBwb29scyAoZGVmYXVsdCB0cnVlKS5cbiAgICogQHBhcmFtIHsoKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPn0gW2FyZ3Mub25TdG9wcGVkXSAtIExpZmVjeWNsZSBob29rIGludm9rZWQgYWZ0ZXIgdGhlIG1haW4gcHJvY2VzcyBmaW5pc2hlcyBzdG9wcGluZy5cbiAgICogQHBhcmFtIHsoYXJnczoge2hhbmRvZmY6IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhhbmRvZmYsIGpvYjogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSkgPT4gdm9pZCB8IFByb21pc2U8dm9pZD59IFthcmdzLmFmdGVySGFuZG9mZkNsYWltXSAtIEV4cGxpY2l0IGhhbmRvZmYtY2xhaW0gb2JzZXJ2YXRpb24gaG9vay5cbiAgICogQHBhcmFtIHsod29ya2VyOiBKc29uU29ja2V0KSA9PiB2b2lkfSBbYXJncy5vbldvcmtlclJlYWR5XSAtIEV4cGxpY2l0IHJlYWRpbmVzcyBvYnNlcnZhdGlvbiBob29rLlxuICAgKiBAcGFyYW0geyh3b3JrZXI6IEpzb25Tb2NrZXQpID0+IHZvaWR9IFthcmdzLm9uV29ya2VySGVhcnRiZWF0XSAtIEV4cGxpY2l0IGhlYXJ0YmVhdCBvYnNlcnZhdGlvbiBob29rLlxuICAgKiBAcGFyYW0geyh3b3JrZXJJZDogc3RyaW5nKSA9PiB2b2lkfSBbYXJncy5vbldvcmtlckRpc2Nvbm5lY3RlZF0gLSBFeHBsaWNpdCBnZW5lcmF0aW9uIGRpc2Nvbm5lY3Qgb2JzZXJ2YXRpb24gaG9vay5cbiAgICogQHBhcmFtIHsod29ya2VySWQ6IHN0cmluZykgPT4gdm9pZH0gW2FyZ3Mub25Xb3JrZXJIYW5kb2Zmc1JlbGVhc2VkXSAtIEV4cGxpY2l0IGdyYWNlLWV4cGlyeSBvYnNlcnZhdGlvbiBob29rLlxuICAgKiBAcGFyYW0geyhqb2JzOiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3dbXSkgPT4gdm9pZH0gW2FyZ3Mub25TdGFydHVwSGFuZG9mZnNSZWNsYWltZWRdIC0gRXhwbGljaXQgc3RhcnR1cCByZWNsYWltIG9ic2VydmF0aW9uIGhvb2suXG4gICAqIEBwYXJhbSB7KGFyZ3M6IHthY2NlcHRlZDogYm9vbGVhbiwgam9iSWQ6IHN0cmluZywgc3RhdHVzOiBcImNvbXBsZXRlZFwiIHwgXCJmYWlsZWRcIiB8IFwicmVzY2hlZHVsZWRcIn0pID0+IHZvaWR9IFthcmdzLm9uSm9iVXBkYXRlZF0gLSBFeHBsaWNpdCBkdXJhYmxlIHJlcG9ydCBvYnNlcnZhdGlvbiBob29rLlxuICAgKiBAcGFyYW0ge3tub3c6ICgpID0+IG51bWJlciwgc2V0VGltZW91dD86IChjYWxsYmFjazogKCkgPT4gdm9pZCwgZGVsYXlNczogbnVtYmVyKSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bWJlciwgY2xlYXJUaW1lb3V0PzogKHRpbWVySWQ6IFJldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVtYmVyKSA9PiB2b2lkfX0gW2FyZ3MuY2xvY2tdIC0gSW5qZWN0YWJsZSB3YWxsIGNsb2NrIGZvciBkZXRlcm1pbmlzdGljIGxpZmVjeWNsZSB0ZXN0cy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBob3N0LCBwb3J0LCBnZW5lcmF0aW9uSWQ6IGV4cGxpY2l0R2VuZXJhdGlvbklkLCBpbml0aWFsR2VuZXJhdGlvblN0YXRlOiBleHBsaWNpdEluaXRpYWxHZW5lcmF0aW9uU3RhdGUsIGxpZmVjeWNsZVNvY2tldFBhdGg6IGV4cGxpY2l0TGlmZWN5Y2xlU29ja2V0UGF0aCwgd29ya2VyU3RhbGVUaW1lb3V0TXMsIHdvcmtlckxpdmVuZXNzU3dlZXBNcywgd29ya2VyUmVjb25uZWN0R3JhY2VNcywgY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zT25TdG9wID0gdHJ1ZSwgb25TdG9wcGVkLCBhZnRlckhhbmRvZmZDbGFpbSwgb25Xb3JrZXJSZWFkeSwgb25Xb3JrZXJIZWFydGJlYXQsIG9uV29ya2VyRGlzY29ubmVjdGVkLCBvbldvcmtlckhhbmRvZmZzUmVsZWFzZWQsIG9uU3RhcnR1cEhhbmRvZmZzUmVjbGFpbWVkLCBvbkpvYlVwZGF0ZWQsIGNsb2NrfSkge1xuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLmNsb3NlRGF0YWJhc2VDb25uZWN0aW9uc09uU3RvcCA9IGNsb3NlRGF0YWJhc2VDb25uZWN0aW9uc09uU3RvcFxuICAgIHRoaXMub25TdG9wcGVkID0gb25TdG9wcGVkXG4gICAgdGhpcy5hZnRlckhhbmRvZmZDbGFpbSA9IGFmdGVySGFuZG9mZkNsYWltXG4gICAgdGhpcy5vbldvcmtlclJlYWR5ID0gb25Xb3JrZXJSZWFkeVxuICAgIHRoaXMub25Xb3JrZXJIZWFydGJlYXQgPSBvbldvcmtlckhlYXJ0YmVhdFxuICAgIHRoaXMub25Xb3JrZXJEaXNjb25uZWN0ZWQgPSBvbldvcmtlckRpc2Nvbm5lY3RlZFxuICAgIHRoaXMub25Xb3JrZXJIYW5kb2Zmc1JlbGVhc2VkID0gb25Xb3JrZXJIYW5kb2Zmc1JlbGVhc2VkXG4gICAgdGhpcy5vblN0YXJ0dXBIYW5kb2Zmc1JlY2xhaW1lZCA9IG9uU3RhcnR1cEhhbmRvZmZzUmVjbGFpbWVkXG4gICAgdGhpcy5vbkpvYlVwZGF0ZWQgPSBvbkpvYlVwZGF0ZWRcbiAgICB0aGlzLmNsb2NrID0ge1xuICAgICAgY2xlYXJUaW1lb3V0OiBjbG9jaz8uY2xlYXJUaW1lb3V0IHx8ICgodGltZXJJZCkgPT4gY2xlYXJUaW1lb3V0KHRpbWVySWQpKSxcbiAgICAgIG5vdzogY2xvY2s/Lm5vdyB8fCAoKCkgPT4gRGF0ZS5ub3coKSksXG4gICAgICBzZXRUaW1lb3V0OiBjbG9jaz8uc2V0VGltZW91dCB8fCAoKGNhbGxiYWNrLCBkZWxheU1zKSA9PiBzZXRUaW1lb3V0KGNhbGxiYWNrLCBkZWxheU1zKSlcbiAgICB9XG4gICAgY29uc3QgY29uZmlnID0gY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpXG4gICAgY29uc3QgZ2VuZXJhdGlvbkNvbmZpZyA9IGNvbmZpZ3VyYXRpb24ucmVzb2x2ZUJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkNvbmZpZyh7XG4gICAgICBnZW5lcmF0aW9uSWQ6IGV4cGxpY2l0R2VuZXJhdGlvbklkLFxuICAgICAgaW5pdGlhbEdlbmVyYXRpb25TdGF0ZTogZXhwbGljaXRJbml0aWFsR2VuZXJhdGlvblN0YXRlLFxuICAgICAgbGlmZWN5Y2xlU29ja2V0UGF0aDogZXhwbGljaXRMaWZlY3ljbGVTb2NrZXRQYXRoLFxuICAgICAgc291cmNlTmFtZTogXCJCYWNrZ3JvdW5kSm9ic01haW5cIlxuICAgIH0pXG4gICAgdGhpcy5nZW5lcmF0aW9uSWQgPSBnZW5lcmF0aW9uQ29uZmlnLmdlbmVyYXRpb25JZFxuICAgIHRoaXMuaW5pdGlhbEdlbmVyYXRpb25TdGF0ZSA9IGdlbmVyYXRpb25Db25maWcuaW5pdGlhbEdlbmVyYXRpb25TdGF0ZVxuICAgIHRoaXMubGlmZWN5Y2xlU29ja2V0UGF0aCA9IGdlbmVyYXRpb25Db25maWcubGlmZWN5Y2xlU29ja2V0UGF0aFxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25MaWZlY3ljbGVTdGF0ZX0gKi9cbiAgICB0aGlzLmxpZmVjeWNsZVN0YXRlID0gXCJzdGFydGluZ1wiXG4gICAgdGhpcy5fYWN0aXZlT3duZXJzaGlwUmVhZHkgPSBmYWxzZVxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9hY3RpdmF0aW9uUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9yZXRpcmVtZW50UHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIC8qKiBAdHlwZSB7U2V0PEpzb25Tb2NrZXQ+fSAqL1xuICAgIHRoaXMuY2FuZGlkYXRlUmVhZHlXb3JrZXJzID0gbmV3IFNldCgpXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCB7d29ya2VyOiBKc29uU29ja2V0LCB0aW1lcjogUmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudW1iZXJ9Pn0gKi9cbiAgICB0aGlzLmRpc2Nvbm5lY3RlZFdvcmtlcnMgPSBuZXcgTWFwKClcbiAgICB0aGlzLl9saWZlY3ljbGVSZXF1ZXN0TGVhc2VzID0gMFxuICAgIHRoaXMuX2FjdGl2ZU5vbldvcmtlclJlcXVlc3RzID0gMFxuICAgIC8qKlxuICAgICAqIFJlc29sdmVzIHN0b3Agb2JzZXJ2YXRpb24uXG4gICAgICogQHR5cGUgeygpID0+IHZvaWR9XG4gICAgICovXG4gICAgdGhpcy5fcmVzb2x2ZVN0b3BwZWQgPSAoKSA9PiB7fVxuICAgIHRoaXMuX3N0b3BwZWRQcm9taXNlID0gbmV3IFByb21pc2UoKC8qKiBAdHlwZSB7KHZhbHVlOiB2b2lkKSA9PiB2b2lkfSAqLyByZXNvbHZlKSA9PiB7IHRoaXMuX3Jlc29sdmVTdG9wcGVkID0gcmVzb2x2ZSB9KVxuICAgIHRoaXMuaG9zdCA9IGhvc3QgfHwgY29uZmlnLmhvc3RcbiAgICB0aGlzLnBvcnQgPSB0eXBlb2YgcG9ydCA9PT0gXCJudW1iZXJcIiA/IHBvcnQgOiBjb25maWcucG9ydFxuICAgIHRoaXMuZGlzcGF0Y2hTdHJhdGVneSA9IGNvbmZpZy5kaXNwYXRjaFN0cmF0ZWd5XG4gICAgdGhpcy5wb2xsSW50ZXJ2YWxNcyA9IGNvbmZpZy5wb2xsSW50ZXJ2YWxNc1xuICAgIHRoaXMuZHJhaW5TdG9yZU9wZXJhdGlvblRpbWVvdXRNcyA9IGNvbmZpZy5kcmFpblN0b3JlT3BlcmF0aW9uVGltZW91dE1zXG4gICAgdGhpcy5yZXRlbnRpb24gPSBjb25maWcucmV0ZW50aW9uXG4gICAgLy8gQSB3b3JrZXIgdGhhdCBzdG9wcyBzZW5kaW5nIGFueXRoaW5nIChoZWFydGJlYXQvcmVhZHkvcmVwb3J0KSBmb3IgdGhpc1xuICAgIC8vIGxvbmcgaXMgdHJlYXRlZCBhcyB3ZWRnZWQvZGVhZDogaXRzIGxlYXNlcyBhcmUgcmVsZWFzZWQgYW5kIGl0IGlzIGRyb3BwZWQuXG4gICAgdGhpcy53b3JrZXJTdGFsZVRpbWVvdXRNcyA9IHR5cGVvZiB3b3JrZXJTdGFsZVRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiAmJiB3b3JrZXJTdGFsZVRpbWVvdXRNcyA+PSAxID8gd29ya2VyU3RhbGVUaW1lb3V0TXMgOiBXT1JLRVJfU1RBTEVfVElNRU9VVF9NU1xuICAgIHRoaXMud29ya2VyTGl2ZW5lc3NTd2VlcE1zID0gdHlwZW9mIHdvcmtlckxpdmVuZXNzU3dlZXBNcyA9PT0gXCJudW1iZXJcIiAmJiB3b3JrZXJMaXZlbmVzc1N3ZWVwTXMgPj0gMSA/IHdvcmtlckxpdmVuZXNzU3dlZXBNcyA6IFdPUktFUl9MSVZFTkVTU19TV0VFUF9NU1xuICAgIHRoaXMud29ya2VyUmVjb25uZWN0R3JhY2VNcyA9IG5vcm1hbGl6ZVdvcmtlclJlY29ubmVjdEdyYWNlTXMod29ya2VyUmVjb25uZWN0R3JhY2VNcylcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vYWRhcHRlci5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuYWRhcHRlciA9IHVuZGVmaW5lZFxuICAgIHRoaXMubG9nZ2VyID0gbmV3IExvZ2dlcih0aGlzKVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7U2V0PEpzb25Tb2NrZXQ+fSAqL1xuICAgIHRoaXMud29ya2VycyA9IG5ldyBTZXQoKVxuICAgIC8qKiBAdHlwZSB7U2V0PEpzb25Tb2NrZXQ+fSAqL1xuICAgIHRoaXMuY29ubmVjdGlvbnMgPSBuZXcgU2V0KClcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1NldDxKc29uU29ja2V0Pn0gKi9cbiAgICB0aGlzLnJlYWR5V29ya2VycyA9IG5ldyBTZXQoKVxuICAgIC8qKlxuICAgICAqIEFjdGl2ZSBkdXJhYmxlIGhhbmRvZmZzIGtleWVkIGJ5IHRoZSBleGFjdCB3b3JrZXIgc29ja2V0IHRoYXQgcmVjZWl2ZWQgdGhlbS5cbiAgICAgKiBAdHlwZSB7TWFwPEpzb25Tb2NrZXQsIE1hcDxzdHJpbmcsIHN0cmluZz4+fSAqL1xuICAgIHRoaXMud29ya2VySGFuZG9mZnMgPSBuZXcgTWFwKClcbiAgICAvKipcbiAgICAgKiBFeGFjdCBjYWxsZXItZ2VuZXJhdGVkIGxlYXNlcyB3aG9zZSBjbGFpbSBvdXRjb21lIHdhcyBhbWJpZ3VvdXMgb3Igd2hvc2VcbiAgICAgKiBwcmUtZGlzcGF0Y2ggcmVsZWFzZSBoYXMgbm90IHlldCBiZWVuIGFja25vd2xlZGdlZC4gUmV0YWluZWQgdW50aWwgYVxuICAgICAqIGZlbmNlZCByZXR1cm4gc3VjY2VlZHMgKGluY2x1ZGluZyBhbiBleGFjdCBuby1vcCkuXG4gICAgICogQHR5cGUge01hcDxzdHJpbmcsIHN0cmluZz59ICovXG4gICAgdGhpcy5wZW5kaW5nSGFuZG9mZlJlY292ZXJpZXMgPSBuZXcgTWFwKClcbiAgICAvKipcbiAgICAgKiBIYW5kb2ZmLWFkb3B0aW9uIHF1ZXJpZXMgc3RhcnRlZCBieSB3b3JrZXIgaGVsbG8gbWVzc2FnZXMuIFNodXRkb3duIG11c3RcbiAgICAgKiB3YWl0IGZvciB0aGVzZSBiZWZvcmUgY2xvc2luZyB0aGUgY29uZmlndXJhdGlvbidzIGRhdGFiYXNlIHBvb2xzLlxuICAgICAqIEB0eXBlIHtTZXQ8UHJvbWlzZTx2b2lkPj59ICovXG4gICAgdGhpcy5pbmZsaWdodFdvcmtlckhhbmRvZmZBZG9wdGlvbnMgPSBuZXcgU2V0KClcbiAgICAvKipcbiAgICAgKiBXb3JrZXIgaWRzIHdob3NlIGhhbmRvZmZzIHdlcmUgc3VjY2Vzc2Z1bGx5IGFkb3B0ZWQgYnkgYSBzdGlsbC1saXZlXG4gICAgICogY29ubmVjdGlvbiBpbiB0aGlzIG1haW4gZ2VuZXJhdGlvbi5cbiAgICAgKiBAdHlwZSB7U2V0PHN0cmluZz59XG4gICAgICovXG4gICAgdGhpcy5yZWNvbm5lY3RlZFdvcmtlcklkcyA9IG5ldyBTZXQoKVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGFuZG9mZlNuYXBzaG90W119ICovXG4gICAgdGhpcy5zdGFydHVwSGFuZG9mZlNuYXBzaG90ID0gW11cbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD5bXX0gKi9cbiAgICB0aGlzLl9zdGFydHVwSGFuZG9mZkFkb3B0aW9uc0F0RGVhZGxpbmUgPSBbXVxuICAgIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmR3JhY2VFbGFwc2VkID0gZmFsc2VcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge25ldC5TZXJ2ZXIgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5zZXJ2ZXIgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX3BvbGxUaW1lciA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudW1iZXIgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fc2NoZWR1bGVkVGltZXIgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2Vycm9yUmV0cnlUaW1lciA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fb3JwaGFuVGltZXIgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldEludGVydmFsPiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl93b3JrZXJTdGFsZVRpbWVyID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bWJlciB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1UaW1lciA9IHVuZGVmaW5lZFxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1Qcm9taXNlID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtCYWNrZ3JvdW5kSm9ic1NjaGVkdWxlciB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLnNjaGVkdWxlciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2RyYWluaW5nID0gZmFsc2VcbiAgICB0aGlzLl9yZWRyYWluUXVldWVkID0gZmFsc2VcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fZHJhaW5Qcm9taXNlID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fc3RvcHBlZCA9IGZhbHNlXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuc3RvcFByb21pc2UgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUgeygoKSA9PiB2b2lkKSB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl91bnN1YnNjcmliZUJlYWNvbiA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7KCguLi5hcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IHZvaWQpIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2JlYWNvbkNvbm5lY3RIYW5kbGVyID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuLi9iZWFjb24vY2xpZW50LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuLi9iZWFjb24vaW4tcHJvY2Vzcy1jbGllbnQuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9iZWFjb25DbGllbnQgPSB1bmRlZmluZWRcbiAgICAvKiogQHR5cGUge0JhY2tncm91bmRKb2JzTGlmZWN5Y2xlQ29udHJvbFNlcnZlciB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLmxpZmVjeWNsZUNvbnRyb2xTZXJ2ZXIgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBDb21wYXRpYmlsaXR5IGFsaWFzIGZvciBpbnRlZ3JhdGlvbnMgdGhhdCBpbnNwZWN0IHRoZSBhY3RpdmUgbWFpbiBzdG9yZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vYWRhcHRlci5qc1wiKS5kZWZhdWx0fSAtIEFkYXB0ZXIgYWNxdWlyZWQgYnkgc3RhcnQuXG4gICAqL1xuICBnZXQgc3RvcmUoKSB7XG4gICAgaWYgKCF0aGlzLmFkYXB0ZXIpIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyBtYWluIGhhcyBub3QgYWNxdWlyZWQgaXRzIGFkYXB0ZXJcIilcblxuICAgIHJldHVybiB0aGlzLmFkYXB0ZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBQcmVzZXJ2ZXMgdGhlIGhpc3RvcmljYWwgc3ViY2xhc3Mgc2VhbSB3aGlsZSBrZWVwaW5nIG9uZSBhZGFwdGVyIHJlZmVyZW5jZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2FkYXB0ZXIuanNcIikuZGVmYXVsdH0gYWRhcHRlciAtIEFkYXB0ZXIgdG8gYXNzaWduLlxuICAgKi9cbiAgc2V0IHN0b3JlKGFkYXB0ZXIpIHtcbiAgICB0aGlzLmFkYXB0ZXIgPSBhZGFwdGVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdGFydC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBsaXN0ZW5pbmcuXG4gICAqL1xuICBhc3luYyBzdGFydCgpIHtcbiAgICB0aGlzLl9zdG9wcGVkID0gZmFsc2VcbiAgICB0aGlzLnN0b3BQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fYWN0aXZlT3duZXJzaGlwUmVhZHkgPSBmYWxzZVxuICAgIHRoaXMubGlmZWN5Y2xlU3RhdGUgPSBcInN0YXJ0aW5nXCJcbiAgICB0aGlzLl9zdG9wcGVkUHJvbWlzZSA9IG5ldyBQcm9taXNlKCgvKiogQHR5cGUgeyh2YWx1ZTogdm9pZCkgPT4gdm9pZH0gKi8gcmVzb2x2ZSkgPT4geyB0aGlzLl9yZXNvbHZlU3RvcHBlZCA9IHJlc29sdmUgfSlcbiAgICB0aGlzLnJlY29ubmVjdGVkV29ya2VySWRzLmNsZWFyKClcbiAgICB0aGlzLnN0YXJ0dXBIYW5kb2ZmU25hcHNob3QgPSBbXVxuICAgIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmQWRvcHRpb25zQXREZWFkbGluZSA9IFtdXG4gICAgdGhpcy5fc3RhcnR1cEhhbmRvZmZHcmFjZUVsYXBzZWQgPSBmYWxzZVxuICAgIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVByb21pc2UgPSB1bmRlZmluZWRcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24uc2V0Q3VycmVudCgpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmluaXRpYWxpemUoe3R5cGU6IFwiYmFja2dyb3VuZC1qb2JzLW1haW5cIn0pXG4gICAgICBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uY29ubmVjdEJlYWNvbih7cGVlclR5cGU6IFwiYmFja2dyb3VuZC1qb2JzLW1haW5cIn0pXG5cbiAgICAgIGlmICghdGhpcy5hZGFwdGVyKSB7XG4gICAgICAgIHRoaXMuYWRhcHRlciA9IGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5hY3F1aXJlUmVhZHlCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoKVxuICAgICAgfVxuICAgICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkICYmICF0aGlzLmFkYXB0ZXIuc3VwcG9ydHNSZWxlYXNlU2NvcGVkR2VuZXJhdGlvbnMoKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJUaGUgY29uZmlndXJlZCBiYWNrZ3JvdW5kIGpvYnMgYWRhcHRlciBkb2VzIG5vdCBzdXBwb3J0IHJlbGVhc2Utc2NvcGVkIGdlbmVyYXRpb25zXCIpXG4gICAgICB9XG4gICAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQgJiYgIXRoaXMuYWRhcHRlci5zdXBwb3J0c093bmVkRW5xdWV1ZUZyb21IYW5kb2ZmKCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVGhlIGNvbmZpZ3VyZWQgYmFja2dyb3VuZCBqb2JzIGFkYXB0ZXIgZG9lcyBub3Qgc3VwcG9ydCBhdG9taWMgb3duZWQtaGFuZG9mZiBlbnF1ZXVlXCIpXG4gICAgICB9XG5cbiAgICAgIGlmICghdGhpcy5nZW5lcmF0aW9uSWQgfHwgdGhpcy5pbml0aWFsR2VuZXJhdGlvblN0YXRlICE9PSBcImNhbmRpZGF0ZVwiKSB7XG4gICAgICAgIHRoaXMuc3RhcnR1cEhhbmRvZmZTbmFwc2hvdCA9IGF3YWl0IHRoaXMuX2dlbmVyYXRpb25Pd25lZEhhbmRvZmZTbmFwc2hvdCgpXG4gICAgICB9XG4gICAgICBjb25zdCBzZXJ2ZXIgPSBuZXQuY3JlYXRlU2VydmVyKChzb2NrZXQpID0+IHRoaXMuX2hhbmRsZUNvbm5lY3Rpb24oc29ja2V0KSlcbiAgICAgIHRoaXMuc2VydmVyID0gc2VydmVyXG5cbiAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgc2VydmVyLm9uY2UoXCJlcnJvclwiLCByZWplY3QpXG4gICAgICAgIHNlcnZlci5saXN0ZW4odGhpcy5wb3J0LCB0aGlzLmhvc3QsICgpID0+IHJlc29sdmUodW5kZWZpbmVkKSlcbiAgICAgIH0pXG5cbiAgICAgIGNvbnN0IGFkZHJlc3MgPSBzZXJ2ZXIuYWRkcmVzcygpXG4gICAgICBpZiAoYWRkcmVzcyAmJiB0eXBlb2YgYWRkcmVzcyA9PT0gXCJvYmplY3RcIikge1xuICAgICAgICB0aGlzLnBvcnQgPSBhZGRyZXNzLnBvcnRcbiAgICAgIH1cblxuICAgICAgdGhpcy5saWZlY3ljbGVTdGF0ZSA9IHRoaXMuZ2VuZXJhdGlvbklkID8gdGhpcy5pbml0aWFsR2VuZXJhdGlvblN0YXRlIDogXCJhY3RpdmVcIlxuXG4gICAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQgJiYgdGhpcy5saWZlY3ljbGVTb2NrZXRQYXRoKSB7XG4gICAgICAgIHRoaXMubGlmZWN5Y2xlQ29udHJvbFNlcnZlciA9IG5ldyBCYWNrZ3JvdW5kSm9ic0xpZmVjeWNsZUNvbnRyb2xTZXJ2ZXIoe1xuICAgICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbixcbiAgICAgICAgICBnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkLFxuICAgICAgICAgIG1haW46IHRoaXMsXG4gICAgICAgICAgc29ja2V0UGF0aDogdGhpcy5saWZlY3ljbGVTb2NrZXRQYXRoXG4gICAgICAgIH0pXG4gICAgICAgIGF3YWl0IHRoaXMubGlmZWN5Y2xlQ29udHJvbFNlcnZlci5zdGFydCgpXG4gICAgICB9XG5cbiAgICAgIHRoaXMuX3dvcmtlclN0YWxlVGltZXIgPSBzZXRJbnRlcnZhbCgoKSA9PiB7XG4gICAgICAgIHZvaWQgdGhpcy5fc3dlZXBTdGFsZVdvcmtlcnMoKVxuICAgICAgfSwgdGhpcy53b3JrZXJMaXZlbmVzc1N3ZWVwTXMpXG5cbiAgICAgIGlmICh0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcImFjdGl2ZVwiKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3N0YXJ0QWN0aXZlT3duZXJzaGlwKFwiYWN0aXZlXCIpXG4gICAgICB9IGVsc2UgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwicmV0aXJlZFwiKSB7XG4gICAgICAgIHRoaXMuX3N0YXJ0R2VuZXJhdGlvblJlY292ZXJ5T3duZXJzaGlwKClcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgbGV0IGNsZWFudXBFcnJvclxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLnN0b3AoKVxuICAgICAgfSBjYXRjaCAoY2F1Z2h0Q2xlYW51cEVycm9yKSB7XG4gICAgICAgIGNsZWFudXBFcnJvciA9IGNhdWdodENsZWFudXBFcnJvclxuICAgICAgfVxuXG4gICAgICBpZiAoY2xlYW51cEVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihcbiAgICAgICAgICBbZXJyb3IsIGNsZWFudXBFcnJvcl0sXG4gICAgICAgICAgXCJCYWNrZ3JvdW5kIGpvYnMgbWFpbiBzdGFydHVwIGFuZCBjbGVhbnVwIGZhaWxlZFwiLFxuICAgICAgICAgIHtjYXVzZTogZXJyb3J9XG4gICAgICAgIClcbiAgICAgIH1cblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdG9wLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNsb3NlZC5cbiAgICovXG4gIHN0b3AoKSB7XG4gICAgaWYgKCF0aGlzLnN0b3BQcm9taXNlKSB0aGlzLnN0b3BQcm9taXNlID0gdGhpcy5fc3RvcCgpXG5cbiAgICByZXR1cm4gdGhpcy5zdG9wUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdGhlIG1haW4tcHJvY2VzcyBzaHV0ZG93biBsaWZlY3ljbGUgb25jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjbG9zZWQuXG4gICAqL1xuICBhc3luYyBfc3RvcCgpIHtcbiAgICB0aGlzLl9zdG9wcGVkID0gdHJ1ZVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHNodXRkb3duTGlmZWN5Y2xlKHtcbiAgICAgICAgb25TdG9wcGVkOiB0aGlzLm9uU3RvcHBlZCxcbiAgICAgICAgc2h1dGRvd246IGFzeW5jICgpID0+IHtcbiAgICAgICAgICB0aGlzLl9jbG9zZVdvcmtlcnMoKVxuICAgICAgICAgIHRoaXMuX2NsZWFyVGltZXJzKClcbiAgICAgICAgICB0aGlzLl9kaXNjb25uZWN0QmVhY29uSGFuZGxlcnMoKVxuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnNjaGVkdWxlcj8uc3RvcCgpXG4gICAgICAgICAgICBpZiAodGhpcy5fZHJhaW5Qcm9taXNlKSBhd2FpdCB0aGlzLl9kcmFpblByb21pc2VcbiAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5fZHJhaW5Xb3JrZXJIYW5kb2ZmQWRvcHRpb25zKClcbiAgICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5fZHJhaW5TdGFydHVwSGFuZG9mZlJlY2xhaW0oKVxuICAgICAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuX3N0b3BCZWFjb25BbmRTZXJ2ZXIoKVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLmFkYXB0ZXIgPSB1bmRlZmluZWRcbiAgICAgIHRoaXMubGlmZWN5Y2xlU3RhdGUgPSBcInN0b3BwZWRcIlxuICAgICAgdGhpcy5fcmVzb2x2ZVN0b3BwZWQoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsb3NlIHdvcmtlcnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAqL1xuICBfY2xvc2VXb3JrZXJzKCkge1xuICAgIGZvciAoY29uc3QgY29ubmVjdGlvbiBvZiB0aGlzLmNvbm5lY3Rpb25zKSB7XG4gICAgICBjb25uZWN0aW9uLmNsb3NlKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGVhciB0aW1lcnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAqL1xuICBfY2xlYXJUaW1lcnMoKSB7XG4gICAgaWYgKHRoaXMuX3BvbGxUaW1lcikgY2xlYXJJbnRlcnZhbCh0aGlzLl9wb2xsVGltZXIpXG4gICAgaWYgKHRoaXMuX3NjaGVkdWxlZFRpbWVyKSB0aGlzLmNsb2NrLmNsZWFyVGltZW91dCh0aGlzLl9zY2hlZHVsZWRUaW1lcilcbiAgICBpZiAodGhpcy5fZXJyb3JSZXRyeVRpbWVyKSBjbGVhclRpbWVvdXQodGhpcy5fZXJyb3JSZXRyeVRpbWVyKVxuICAgIGlmICh0aGlzLl9vcnBoYW5UaW1lcikgY2xlYXJJbnRlcnZhbCh0aGlzLl9vcnBoYW5UaW1lcilcbiAgICBpZiAodGhpcy5fd29ya2VyU3RhbGVUaW1lcikgY2xlYXJJbnRlcnZhbCh0aGlzLl93b3JrZXJTdGFsZVRpbWVyKVxuICAgIGlmICh0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1UaW1lcikgdGhpcy5jbG9jay5jbGVhclRpbWVvdXQodGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltVGltZXIpXG4gICAgZm9yIChjb25zdCB7dGltZXJ9IG9mIHRoaXMuZGlzY29ubmVjdGVkV29ya2Vycy52YWx1ZXMoKSkgdGhpcy5jbG9jay5jbGVhclRpbWVvdXQodGltZXIpXG4gICAgdGhpcy5kaXNjb25uZWN0ZWRXb3JrZXJzLmNsZWFyKClcbiAgICB0aGlzLl9wb2xsVGltZXIgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9zY2hlZHVsZWRUaW1lciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2Vycm9yUmV0cnlUaW1lciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX29ycGhhblRpbWVyID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fd29ya2VyU3RhbGVUaW1lciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVRpbWVyID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkaXNjb25uZWN0IGJlYWNvbiBoYW5kbGVycy5cbiAgICogQHJldHVybnMge3ZvaWR9ICovXG4gIF9kaXNjb25uZWN0QmVhY29uSGFuZGxlcnMoKSB7XG4gICAgaWYgKHRoaXMuX3Vuc3Vic2NyaWJlQmVhY29uKSB7XG4gICAgICB0aGlzLl91bnN1YnNjcmliZUJlYWNvbigpXG4gICAgICB0aGlzLl91bnN1YnNjcmliZUJlYWNvbiA9IHVuZGVmaW5lZFxuICAgIH1cblxuICAgIGlmICh0aGlzLl9iZWFjb25DbGllbnQgJiYgdGhpcy5fYmVhY29uQ29ubmVjdEhhbmRsZXIpIHtcbiAgICAgIHRoaXMuX2JlYWNvbkNsaWVudC5vZmYoXCJjb25uZWN0XCIsIHRoaXMuX2JlYWNvbkNvbm5lY3RIYW5kbGVyKVxuICAgIH1cbiAgICB0aGlzLl9iZWFjb25Db25uZWN0SGFuZGxlciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2JlYWNvbkNsaWVudCA9IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RvcCBiZWFjb24gYW5kIHNlcnZlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59ICovXG4gIGFzeW5jIF9zdG9wQmVhY29uQW5kU2VydmVyKCkge1xuICAgIGF3YWl0IHJ1blNodXRkb3duU3RlcHMoe1xuICAgICAgbWVzc2FnZTogXCJCYWNrZ3JvdW5kIGpvYnMgbWFpbiBhcHBsaWNhdGlvbiBhbmQgZnJhbWV3b3JrIHNodXRkb3duIGZhaWxlZFwiLFxuICAgICAgc3RlcHM6IFtcbiAgICAgICAgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmxpZmVjeWNsZUNvbnRyb2xTZXJ2ZXI/LmNsb3NlKClcbiAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgdGhpcy5saWZlY3ljbGVDb250cm9sU2VydmVyID0gdW5kZWZpbmVkXG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICAuLi4odGhpcy5jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3BcbiAgICAgICAgICA/IFthc3luYyAoKSA9PiBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uc2h1dGRvd24oKV1cbiAgICAgICAgICA6IFtdKSxcbiAgICAgICAgYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmRpc2Nvbm5lY3RCZWFjb24oKSxcbiAgICAgICAgYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5fY2xvc2VTZXJ2ZXIoKSxcbiAgICAgICAgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGlmICh0aGlzLmNsb3NlRGF0YWJhc2VDb25uZWN0aW9uc09uU3RvcCkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmNsb3NlRGF0YWJhc2VDb25uZWN0aW9ucygpXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5jbG9zZUJhY2tncm91bmRKb2JzQWRhcHRlcigpXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICBdXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsb3NlIHNlcnZlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59ICovXG4gIGFzeW5jIF9jbG9zZVNlcnZlcigpIHtcbiAgICBpZiAoIXRoaXMuc2VydmVyKSByZXR1cm5cblxuICAgIGNvbnN0IHtzZXJ2ZXJ9ID0gdGhpc1xuICAgIHRoaXMuc2VydmVyID0gdW5kZWZpbmVkXG4gICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHNlcnZlci5jbG9zZSgoKSA9PiByZXNvbHZlKHVuZGVmaW5lZCkpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHBvcnQuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gQm91bmQgcG9ydC5cbiAgICovXG4gIGdldFBvcnQoKSB7XG4gICAgcmV0dXJuIHRoaXMucG9ydFxuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgdGhlIGxpZmVjeWNsZSBzdGF0ZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uTGlmZWN5Y2xlU3RhdGV9IC0gQ3VycmVudCBsaWZlY3ljbGUgc3RhdGUuXG4gICAqL1xuICBnZXRMaWZlY3ljbGVTdGF0ZSgpIHsgcmV0dXJuIHRoaXMubGlmZWN5Y2xlU3RhdGUgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGEgcHJvbWlzZSB0aGF0IHNldHRsZXMgb25seSBhZnRlciB0aGUgbWFpbiBoYXMgZnVsbHkgc3RvcHBlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gU3RvcCBjb21wbGV0aW9uLlxuICAgKi9cbiAgYXN5bmMgd2FpdFVudGlsU3RvcHBlZCgpIHsgYXdhaXQgdGhpcy5fc3RvcHBlZFByb21pc2UgfVxuXG4gIC8qKlxuICAgKiBTbmFwc2hvdHMgb25seSBleGFjdCBkdXJhYmxlIG93bmVycyBmcm9tIHRoaXMgcmVsZWFzZSBnZW5lcmF0aW9uLlxuICAgKiBMZWdhY3kgbW9kZSBpbnRlbnRpb25hbGx5IHJldGFpbnMgaXRzIGhpc3RvcmljYWwgZ2xvYmFsIHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JIYW5kb2ZmU25hcHNob3RbXT59IC0gT3duZWQgc25hcHNob3QuXG4gICAqL1xuICBhc3luYyBfZ2VuZXJhdGlvbk93bmVkSGFuZG9mZlNuYXBzaG90KCkge1xuICAgIGNvbnN0IGhhbmRvZmZzID0gYXdhaXQgdGhpcy5zdG9yZS5zbmFwc2hvdEhhbmRlZE9mZkpvYnMoKVxuXG4gICAgaWYgKCF0aGlzLmdlbmVyYXRpb25JZCkgcmV0dXJuIGhhbmRvZmZzXG4gICAgY29uc3QgZ2VuZXJhdGlvbklkID0gdGhpcy5nZW5lcmF0aW9uSWRcblxuICAgIHJldHVybiBoYW5kb2Zmcy5maWx0ZXIoKHt3b3JrZXJJZH0pID0+IHdvcmtlcklkQmVsb25nc1RvR2VuZXJhdGlvbih7Z2VuZXJhdGlvbklkLCB3b3JrZXJJZH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIEFjcXVpcmVzIHNjaGVkdWxpbmcgYW5kIGRpc3BhdGNoIG93bmVyc2hpcCBmb3IgYW4gYWN0aXZlIGdlbmVyYXRpb24uXG4gICAqIEBwYXJhbSB7XCJhY3RpdmVcIiB8IFwiY2FuZGlkYXRlXCJ9IGV4cGVjdGVkTGlmZWN5Y2xlU3RhdGUgLSBTdGF0ZSB0aGF0IHN0aWxsIG93bnMgYWN0aXZhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBhY3RpdmUgb3duZXJzaGlwIHdhcyBlc3RhYmxpc2hlZC5cbiAgICovXG4gIGFzeW5jIF9zdGFydEFjdGl2ZU93bmVyc2hpcChleHBlY3RlZExpZmVjeWNsZVN0YXRlKSB7XG4gICAgYXdhaXQgdGhpcy5zdG9yZS5yZWNvbmNpbGVRdWV1ZUNvbmN1cnJlbmN5KClcbiAgICBpZiAodGhpcy5saWZlY3ljbGVTdGF0ZSAhPT0gZXhwZWN0ZWRMaWZlY3ljbGVTdGF0ZSkgcmV0dXJuIGZhbHNlXG4gICAgdGhpcy5fc2V0dXBEaXNwYXRjaFRyaWdnZXJzKClcbiAgICB0aGlzLl9zdGFydE9ycGhhblN3ZWVwKClcbiAgICBhd2FpdCB0aGlzLl9zdGFydFNjaGVkdWxlcigpXG4gICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgIT09IGV4cGVjdGVkTGlmZWN5Y2xlU3RhdGUpIHtcbiAgICAgIGlmICh0aGlzLnNjaGVkdWxlcikgYXdhaXQgdGhpcy5zY2hlZHVsZXIuc3RvcCgpXG4gICAgICB0aGlzLnNjaGVkdWxlciA9IHVuZGVmaW5lZFxuICAgICAgdGhpcy5fY2xlYXJEaXNwYXRjaFRpbWVycygpXG4gICAgICB0aGlzLl9kaXNjb25uZWN0QmVhY29uSGFuZGxlcnMoKVxuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuICAgIHRoaXMuX2FjdGl2ZU93bmVyc2hpcFJlYWR5ID0gdHJ1ZVxuICAgIHRoaXMuX2NyZWRpdFJlYWR5V29ya2VycygpXG4gICAgYXdhaXQgdGhpcy5fZHJhaW4oKVxuICAgIGlmICh0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBleHBlY3RlZExpZmVjeWNsZVN0YXRlKSB0aGlzLl9zZXR1cFN0YXJ0dXBIYW5kb2ZmUmVjbGFpbSgpXG4gICAgcmV0dXJuIHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IGV4cGVjdGVkTGlmZWN5Y2xlU3RhdGVcbiAgfVxuXG4gIC8qKiBTdGFydHMgZXhhY3QgcmVjb3ZlcnkgZHV0aWVzIHdpdGhvdXQgYWNxdWlyaW5nIGdsb2JhbCBkaXNwYXRjaCBvd25lcnNoaXAuICovXG4gIF9zdGFydEdlbmVyYXRpb25SZWNvdmVyeU93bmVyc2hpcCgpIHtcbiAgICB0aGlzLl9zZXR1cFN0YXJ0dXBIYW5kb2ZmUmVjbGFpbSgpXG4gICAgdGhpcy5fc3RhcnRPcnBoYW5Td2VlcCgpXG4gICAgdGhpcy5fbWF5YmVTdG9wUmV0aXJlZCgpXG4gIH1cblxuICAvKiogU3RhcnRzIHRoZSBnZW5lcmF0aW9uLWZlbmNlZCBvcnBoYW4gc3dlZXAuICovXG4gIF9zdGFydE9ycGhhblN3ZWVwKCkge1xuICAgIGlmICh0aGlzLl9vcnBoYW5UaW1lcikgcmV0dXJuXG5cbiAgICB0aGlzLl9vcnBoYW5UaW1lciA9IHNldEludGVydmFsKCgpID0+IHsgdm9pZCB0aGlzLl9zd2VlcE9ycGhhbnMoKSB9LCA2MDAwMClcbiAgfVxuXG4gIC8qKlxuICAgKiBTdGFydHMgc2NoZWR1bGUgb3duZXJzaGlwIGV4YWN0bHkgb25jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgc2NoZWR1bGVzIGFyZSBsb2FkZWQuXG4gICAqL1xuICBhc3luYyBfc3RhcnRTY2hlZHVsZXIoKSB7XG4gICAgaWYgKHRoaXMuc2NoZWR1bGVyKSByZXR1cm5cblxuICAgIHRoaXMuc2NoZWR1bGVyID0gbmV3IEJhY2tncm91bmRKb2JzU2NoZWR1bGVyKHtcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbixcbiAgICAgIGVucXVldWVKb2I6IGFzeW5jICh7YXJncywgam9iQ2xhc3MsIG9wdGlvbnN9KSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMuc3RvcmUuZW5xdWV1ZSh7XG4gICAgICAgICAgam9iTmFtZTogam9iQ2xhc3Muam9iTmFtZSgpLFxuICAgICAgICAgIGFyZ3MsXG4gICAgICAgICAgb3B0aW9uczogam9iQ2xhc3MuX3dpdGhKb2JDb250ZXh0KHtqb2JBcmdzOiBhcmdzLCBqb2JPcHRpb25zOiBvcHRpb25zfSlcbiAgICAgICAgfSlcbiAgICAgICAgdGhpcy5fbm90aWZ5RW5xdWV1ZWQoKVxuICAgICAgICB2b2lkIHRoaXMuX2RyYWluKClcbiAgICAgIH1cbiAgICB9KVxuICAgIGF3YWl0IHRoaXMuc2NoZWR1bGVyLnN0YXJ0KClcblxuICAgIGNvbnN0IHJldGVudGlvblNjaGVkdWxlID0gUHJ1bmVUZXJtaW5hbEJhY2tncm91bmRKb2JzSm9iLnNjaGVkdWxlQ29uZmlndXJhdGlvbih0aGlzLnJldGVudGlvbilcblxuICAgIGlmIChyZXRlbnRpb25TY2hlZHVsZSkge1xuICAgICAgdGhpcy5zY2hlZHVsZXIuc2NoZWR1bGVKb2Ioe2pvYkNvbmZpZ3VyYXRpb246IHJldGVudGlvblNjaGVkdWxlLCBqb2JLZXk6IFwidmVsb2Npb3VzUHJ1bmVUZXJtaW5hbEJhY2tncm91bmRKb2JzXCJ9KVxuICAgIH1cbiAgfVxuXG4gIC8qKiBDcmVkaXRzIHJlYWRpbmVzcyBhZHZlcnRpc2VtZW50cyByZWNvcmRlZCB3aGlsZSBkaXNwYXRjaCB3YXMgZmVuY2VkLiAqL1xuICBfY3JlZGl0UmVhZHlXb3JrZXJzKCkge1xuICAgIGZvciAoY29uc3Qgd29ya2VyIG9mIHRoaXMuY2FuZGlkYXRlUmVhZHlXb3JrZXJzKSB7XG4gICAgICBpZiAodGhpcy53b3JrZXJzLmhhcyh3b3JrZXIpICYmICF3b3JrZXIuaXNEcmFpbmluZyAmJiB3b3JrZXIuc3VwcG9ydHNIYW5kb2ZmSWRSZXBvcnRpbmcpIHtcbiAgICAgICAgdGhpcy5yZWFkeVdvcmtlcnMuYWRkKHdvcmtlcilcbiAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5jYW5kaWRhdGVSZWFkeVdvcmtlcnMuY2xlYXIoKVxuICB9XG5cbiAgLyoqXG4gICAqIEFjdGl2YXRlcyBhIGNhbmRpZGF0ZSBhZnRlciBpdHMgc3VwZXJ2aXNvciBoYXMgcmV0aXJlZCB0aGUgb2xkIGdlbmVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHNjaGVkdWxpbmcgYW5kIGRpc3BhdGNoIGFyZSBhY3RpdmUuXG4gICAqL1xuICBhY3RpdmF0ZSgpIHtcbiAgICBpZiAoIXRoaXMuZ2VuZXJhdGlvbklkKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgZ2VuZXJhdGlvbiBhY3RpdmF0aW9uIHJlcXVpcmVzIGdlbmVyYXRpb24gbW9kZVwiKVxuICAgIGlmICh0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcImFjdGl2ZVwiKSByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKClcbiAgICBpZiAodGhpcy5saWZlY3ljbGVTdGF0ZSAhPT0gXCJjYW5kaWRhdGVcIikgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgYWN0aXZhdGUgYmFja2dyb3VuZCBqb2JzIGdlbmVyYXRpb24gZnJvbSAke3RoaXMubGlmZWN5Y2xlU3RhdGV9YClcbiAgICBpZiAoIXRoaXMuX2FjdGl2YXRpb25Qcm9taXNlKSB0aGlzLl9hY3RpdmF0aW9uUHJvbWlzZSA9IHRoaXMuX2FjdGl2YXRlKClcblxuICAgIHJldHVybiB0aGlzLl9hY3RpdmF0aW9uUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWN0aXZhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gQWN0aXZhdGlvbiBjb21wbGV0aW9uLlxuICAgKi9cbiAgYXN5bmMgX2FjdGl2YXRlKCkge1xuICAgIHRoaXMubG9nZ2VyLmluZm8oKCkgPT4gW1wiQmFja2dyb3VuZCBqb2JzIGdlbmVyYXRpb24gYWN0aXZhdGlvbiBzdGFydGluZ1wiLCB7Z2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZH1dKVxuICAgIGNvbnN0IG93bmVyc2hpcFN0YXJ0ZWQgPSBhd2FpdCB0aGlzLl9zdGFydEFjdGl2ZU93bmVyc2hpcChcImNhbmRpZGF0ZVwiKVxuICAgIGlmICghb3duZXJzaGlwU3RhcnRlZCB8fCB0aGlzLmxpZmVjeWNsZVN0YXRlICE9PSBcImNhbmRpZGF0ZVwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgZ2VuZXJhdGlvbiByZXRpcmVtZW50IHN0YXJ0ZWQgYmVmb3JlIGFjdGl2YXRpb24gYWNxdWlyZWQgb3duZXJzaGlwXCIpXG4gICAgfVxuICAgIHRoaXMubGlmZWN5Y2xlU3RhdGUgPSBcImFjdGl2ZVwiXG4gICAgdGhpcy5fY3JlZGl0UmVhZHlXb3JrZXJzKClcbiAgICB0aGlzLmxvZ2dlci5pbmZvKCgpID0+IFtcIkJhY2tncm91bmQgam9icyBnZW5lcmF0aW9uIGFjdGl2YXRpb24gYWNrbm93bGVkZ2VkXCIsIHtnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkfV0pXG4gICAgdm9pZCB0aGlzLl9kcmFpbigpLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiQmFja2dyb3VuZCBqb2JzIGdlbmVyYXRpb24gcG9zdC1hY3RpdmF0aW9uIGRyYWluIGZhaWxlZFwiLCB7ZXJyb3IsIGdlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWR9XSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEVzdGFibGlzaGVzIHRoZSBzeW5jaHJvbm91cyByZXRpcmVtZW50IGZlbmNlIGFuZCB0aGVuIGRyYWlucyBvd25lcnNoaXAgc2V0dXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSByZXRpcmVtZW50IGZlbmNlIGlzIGR1cmFibGUgaW4gbWVtb3J5LlxuICAgKi9cbiAgcmV0aXJlKCkge1xuICAgIGlmICghdGhpcy5nZW5lcmF0aW9uSWQpIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyBnZW5lcmF0aW9uIHJldGlyZW1lbnQgcmVxdWlyZXMgZ2VuZXJhdGlvbiBtb2RlXCIpXG4gICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwicmV0aXJpbmdcIiB8fCB0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcInJldGlyZWRcIikgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpXG4gICAgY29uc3QgYWN0aXZhdGlvbkluUHJvZ3Jlc3MgPSB0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcImNhbmRpZGF0ZVwiICYmIEJvb2xlYW4odGhpcy5fYWN0aXZhdGlvblByb21pc2UpXG4gICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgIT09IFwiYWN0aXZlXCIgJiYgIWFjdGl2YXRpb25JblByb2dyZXNzKSB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCByZXRpcmUgYmFja2dyb3VuZCBqb2JzIGdlbmVyYXRpb24gZnJvbSAke3RoaXMubGlmZWN5Y2xlU3RhdGV9YClcblxuICAgIHRoaXMubGlmZWN5Y2xlU3RhdGUgPSBcInJldGlyaW5nXCJcbiAgICB0aGlzLl9hY3RpdmVPd25lcnNoaXBSZWFkeSA9IGZhbHNlXG4gICAgdGhpcy5yZWFkeVdvcmtlcnMuY2xlYXIoKVxuICAgIHRoaXMuY2FuZGlkYXRlUmVhZHlXb3JrZXJzLmNsZWFyKClcbiAgICB0aGlzLl9jbGVhckRpc3BhdGNoVGltZXJzKClcbiAgICB0aGlzLl9kaXNjb25uZWN0QmVhY29uSGFuZGxlcnMoKVxuICAgIHRoaXMuX3JldGlyZW1lbnRQcm9taXNlID0gdGhpcy5fcmV0aXJlKClcbiAgICB2b2lkIHRoaXMuX3JldGlyZW1lbnRQcm9taXNlLmNhdGNoKChlcnJvcikgPT4gdGhpcy5fcmVwb3J0Q29ubmVjdGlvbkhhbmRsZXJFcnJvcihlcnJvcikpXG5cbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJldGlyZW1lbnQgYWZ0ZXIgaXRzIHN5bmNocm9ub3VzIGZlbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXRpcmVtZW50IGZlbmNlIGNvbXBsZXRpb24uXG4gICAqL1xuICBhc3luYyBfcmV0aXJlKCkge1xuICAgIGlmICh0aGlzLl9hY3RpdmF0aW9uUHJvbWlzZSkgYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKFt0aGlzLl9hY3RpdmF0aW9uUHJvbWlzZV0pXG4gICAgaWYgKHRoaXMuc2NoZWR1bGVyKSBhd2FpdCB0aGlzLnNjaGVkdWxlci5zdG9wKClcbiAgICB0aGlzLnNjaGVkdWxlciA9IHVuZGVmaW5lZFxuICAgIGlmICh0aGlzLl9kcmFpblByb21pc2UpIGF3YWl0IHRoaXMuX2RyYWluUHJvbWlzZVxuICAgIGlmICh0aGlzLl9zdG9wcGVkKSByZXR1cm5cblxuICAgIGZvciAoY29uc3Qgd29ya2VyIG9mIHRoaXMud29ya2Vycykge1xuICAgICAgd29ya2VyLmlzRHJhaW5pbmcgPSB0cnVlXG4gICAgICB3b3JrZXIuc2VuZCh7dHlwZTogXCJyZXRpcmVcIiwgZ2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZH0pXG4gICAgfVxuXG4gICAgdGhpcy5saWZlY3ljbGVTdGF0ZSA9IFwicmV0aXJlZFwiXG4gICAgdGhpcy5fc3RhcnRHZW5lcmF0aW9uUmVjb3ZlcnlPd25lcnNoaXAoKVxuICB9XG5cbiAgLyoqIENsZWFycyB0aW1lcnMgdGhhdCBjYW4gaW5pdGlhdGUgbmV3IGdsb2JhbCBkaXNwYXRjaCBvciBzY2hlZHVsZSB3b3JrLiAqL1xuICBfY2xlYXJEaXNwYXRjaFRpbWVycygpIHtcbiAgICBpZiAodGhpcy5fcG9sbFRpbWVyKSBjbGVhckludGVydmFsKHRoaXMuX3BvbGxUaW1lcilcbiAgICBpZiAodGhpcy5fc2NoZWR1bGVkVGltZXIpIHRoaXMuY2xvY2suY2xlYXJUaW1lb3V0KHRoaXMuX3NjaGVkdWxlZFRpbWVyKVxuICAgIGlmICh0aGlzLl9lcnJvclJldHJ5VGltZXIpIGNsZWFyVGltZW91dCh0aGlzLl9lcnJvclJldHJ5VGltZXIpXG4gICAgdGhpcy5fcG9sbFRpbWVyID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fc2NoZWR1bGVkVGltZXIgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9lcnJvclJldHJ5VGltZXIgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKiBIb2xkcyB0aGUgbWFpbiBvcGVuIHVudGlsIGEgbGlmZWN5Y2xlIHJlc3BvbnNlIGhhcyBmbHVzaGVkLiAqL1xuICBhY3F1aXJlTGlmZWN5Y2xlUmVxdWVzdExlYXNlKCkgeyB0aGlzLl9saWZlY3ljbGVSZXF1ZXN0TGVhc2VzICs9IDEgfVxuXG4gIC8qKiBSZWxlYXNlcyBvbmUgbGlmZWN5Y2xlLXJlc3BvbnNlIGxlYXNlIGFmdGVyIGl0cyBzb2NrZXQgd3JpdGUgY2FsbGJhY2suICovXG4gIHJlbGVhc2VMaWZlY3ljbGVSZXF1ZXN0TGVhc2UoKSB7XG4gICAgaWYgKHRoaXMuX2xpZmVjeWNsZVJlcXVlc3RMZWFzZXMgPCAxKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBiYWNrZ3JvdW5kIGpvYnMgbGlmZWN5Y2xlIHJlcXVlc3QgbGVhc2UgdG8gcmVsZWFzZVwiKVxuICAgIHRoaXMuX2xpZmVjeWNsZVJlcXVlc3RMZWFzZXMgLT0gMVxuICAgIHRoaXMuX21heWJlU3RvcFJldGlyZWQoKVxuICB9XG5cbiAgLyoqIFN0b3BzIGEgcmV0aXJlZCBnZW5lcmF0aW9uIG9ubHkgYWZ0ZXIgaXRzIGV4YWN0IG93bmVyc2hpcCBoYXMgZHJhaW5lZC4gKi9cbiAgX21heWJlU3RvcFJldGlyZWQoKSB7XG4gICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgIT09IFwicmV0aXJlZFwiIHx8IHRoaXMuX3N0b3BwZWQgfHwgdGhpcy5zdG9wUHJvbWlzZSkgcmV0dXJuXG4gICAgaWYgKHRoaXMuX2xpZmVjeWNsZVJlcXVlc3RMZWFzZXMgPiAwIHx8IHRoaXMuX2FjdGl2ZU5vbldvcmtlclJlcXVlc3RzID4gMCB8fCB0aGlzLndvcmtlcnMuc2l6ZSA+IDAgfHwgdGhpcy5kaXNjb25uZWN0ZWRXb3JrZXJzLnNpemUgPiAwKSByZXR1cm5cbiAgICBpZiAodGhpcy5pbmZsaWdodFdvcmtlckhhbmRvZmZBZG9wdGlvbnMuc2l6ZSA+IDAgfHwgdGhpcy5wZW5kaW5nSGFuZG9mZlJlY292ZXJpZXMuc2l6ZSA+IDApIHJldHVyblxuICAgIGlmICh0aGlzLl9kcmFpblByb21pc2UgfHwgdGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltUHJvbWlzZSB8fCB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1UaW1lcikgcmV0dXJuXG4gICAgaWYgKHRoaXMuc3RhcnR1cEhhbmRvZmZTbmFwc2hvdC5sZW5ndGggPiAwKSByZXR1cm5cblxuICAgIGZvciAoY29uc3QgaGFuZG9mZnMgb2YgdGhpcy53b3JrZXJIYW5kb2Zmcy52YWx1ZXMoKSkge1xuICAgICAgaWYgKGhhbmRvZmZzLnNpemUgPiAwKSByZXR1cm5cbiAgICB9XG5cbiAgICB2b2lkIHRoaXMuc3RvcCgpLmNhdGNoKChlcnJvcikgPT4gdGhpcy5fcmVwb3J0Q29ubmVjdGlvbkhhbmRsZXJFcnJvcihlcnJvcikpXG4gIH1cblxuICAvKipcbiAgICogV2lyZXMgdXAgdGhlIGRpc3BhdGNoLXRyaWdnZXJpbmcgc2lnbmFsIHNvdXJjZXMgZm9yIHRoZSBjb25maWd1cmVkXG4gICAqIHN0cmF0ZWd5LiBJbiBgXCJiZWFjb25cImAgbW9kZSAoZGVmYXVsdCkgdGhpcyBtZWFucyBzdWJzY3JpYmluZyB0byB0aGVcbiAgICogYHZlbG9jaW91cy1iYWNrZ3JvdW5kLWpvYnMtZGlzcGF0Y2hgIGNoYW5uZWwgZm9yIGNyb3NzLXByb2Nlc3NcbiAgICogd2FrZS11cHMsIGxpc3RlbmluZyBmb3IgQmVhY29uIChyZSljb25uZWN0cyB0byBjYXRjaCB1cCBvbiBtaXNzZWRcbiAgICogd29yaywgYW5kIHJlbHlpbmcgb24gZGlyZWN0IGluLXByb2Nlc3MgY2FsbHMgZnJvbSBgX2hhbmRsZUVucXVldWVgLFxuICAgKiBgX2hhbmRsZUpvYkNvbXBsZXRlYC9gRmFpbGVkYCwgd29ya2VyIGhlbGxvL3JlYWR5LCBhbmQgdGhlXG4gICAqIHNjaGVkdWxlZC1qb2IgYHNldFRpbWVvdXRgLiBJbiBgXCJwb2xsaW5nXCJgIG1vZGUgd2UgcmVzdG9yZSB0aGVcbiAgICogbGVnYWN5IGZpeGVkLWludGVydmFsIHBvbGwgZm9yIHVzZXJzIHdobyB3YW50IHRoZSBwcmV2aW91cyBiZWhhdmlvci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2V0dXBEaXNwYXRjaFRyaWdnZXJzKCkge1xuICAgIGlmICh0aGlzLmRpc3BhdGNoU3RyYXRlZ3kgPT09IFwicG9sbGluZ1wiKSB7XG4gICAgICB0aGlzLl9wb2xsVGltZXIgPSBzZXRJbnRlcnZhbCgoKSA9PiB7XG4gICAgICAgIHZvaWQgdGhpcy5fcmV0cnlBZnRlckVycm9yKClcbiAgICAgIH0sIHRoaXMucG9sbEludGVydmFsTXMpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBiZWFjb25DbGllbnQgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmVhY29uQ2xpZW50KClcbiAgICBpZiAoIWJlYWNvbkNsaWVudCkgcmV0dXJuXG5cbiAgICB0aGlzLl9iZWFjb25DbGllbnQgPSBiZWFjb25DbGllbnRcblxuICAgIHRoaXMuX3Vuc3Vic2NyaWJlQmVhY29uID0gYmVhY29uQ2xpZW50Lm9uQnJvYWRjYXN0KChtZXNzYWdlKSA9PiB7XG4gICAgICBpZiAobWVzc2FnZT8uY2hhbm5lbCAhPT0gRElTUEFUQ0hfQ0hBTk5FTCkgcmV0dXJuXG4gICAgICB2b2lkIHRoaXMuX2RyYWluKClcbiAgICB9KVxuXG4gICAgLy8gRHJhaW4gb24gZXZlcnkgKHJlKWNvbm5lY3QgdG8gY2F0Y2ggdXAgb24gam9icyBlbnF1ZXVlZCB3aGlsZSB0aGVcbiAgICAvLyBidXMgd2FzIHVucmVhY2hhYmxlLiBUaGUgREIgaXMgdGhlIGR1cmFibGUgbG9nOyBCZWFjb24gaXMganVzdCB0aGVcbiAgICAvLyB3YWtlLXVwIHNpZ25hbC5cbiAgICB0aGlzLl9iZWFjb25Db25uZWN0SGFuZGxlciA9ICgpID0+IHtcbiAgICAgIHZvaWQgdGhpcy5fZHJhaW4oKVxuICAgIH1cbiAgICBiZWFjb25DbGllbnQub24oXCJjb25uZWN0XCIsIHRoaXMuX2JlYWNvbkNvbm5lY3RIYW5kbGVyKVxuICB9XG5cbiAgLyoqXG4gICAqIEFybXMgdGhlIGJvdW5kZWQgYWRvcHRpb24gZ3JhY2Ugb25seSB3aGVuIHN0YXJ0dXAgZm91bmQgZXhhY3QgcGVyc2lzdGVkXG4gICAqIGhhbmRvZmZzLiBUaGUgdGltZXIgaXMgdW5yZWZlZCBzbyBhbiBvdGhlcndpc2UtZmluaXNoZWQgcHJvY2VzcyBpcyBuZXZlclxuICAgKiByZXRhaW5lZCBzb2xlbHkgdG8gcGVyZm9ybSB0aGlzIGNsZWFudXAuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3NldHVwU3RhcnR1cEhhbmRvZmZSZWNsYWltKCkge1xuICAgIGlmICh0aGlzLnN0YXJ0dXBIYW5kb2ZmU25hcHNob3QubGVuZ3RoID09PSAwKSByZXR1cm5cbiAgICBpZiAodGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltVGltZXIgfHwgdGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltUHJvbWlzZSB8fCB0aGlzLl9zdGFydHVwSGFuZG9mZkdyYWNlRWxhcHNlZCkgcmV0dXJuXG5cbiAgICB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1UaW1lciA9IHRoaXMuY2xvY2suc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1UaW1lciA9IHVuZGVmaW5lZFxuICAgICAgdGhpcy5fc3RhcnR1cEhhbmRvZmZBZG9wdGlvbnNBdERlYWRsaW5lID0gWy4uLnRoaXMuaW5mbGlnaHRXb3JrZXJIYW5kb2ZmQWRvcHRpb25zXVxuICAgICAgdGhpcy5fc3RhcnR1cEhhbmRvZmZHcmFjZUVsYXBzZWQgPSB0cnVlXG4gICAgICB2b2lkIHRoaXMuX3N0YXJ0U3RhcnR1cEhhbmRvZmZSZWNsYWltKClcbiAgICB9LCB0aGlzLndvcmtlclJlY29ubmVjdEdyYWNlTXMpXG4gICAgaWYgKHR5cGVvZiB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1UaW1lciA9PT0gXCJvYmplY3RcIikgdGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltVGltZXIudW5yZWYoKVxuICB9XG5cbiAgLyoqXG4gICAqIFN0YXJ0cyBvbmUgdHJhY2tlZCBzdGFydHVwLXJlY2xhaW0gcGFzcywgY29hbGVzY2luZyBsaWZlY3ljbGUgYW5kIHJldHJ5XG4gICAqIGNhbGxlcnMgc28gc2h1dGRvd24gY2FuIHdhaXQgZm9yIGR1cmFibGUgbXV0YXRpb24gYmVmb3JlIGNsb3NpbmcgcG9vbHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoaXMgcGFzcyBzZXR0bGVzLlxuICAgKi9cbiAgX3N0YXJ0U3RhcnR1cEhhbmRvZmZSZWNsYWltKCkge1xuICAgIGlmICh0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1Qcm9taXNlKSByZXR1cm4gdGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltUHJvbWlzZVxuXG4gICAgY29uc3QgcmVjbGFpbSA9IHRoaXMuX3JlY2xhaW1EaXNjb25uZWN0ZWRTdGFydHVwSGFuZG9mZnMoKVxuXG4gICAgdGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltUHJvbWlzZSA9IHJlY2xhaW1cbiAgICBjb25zdCBjbGVhclJlY2xhaW0gPSAoKSA9PiB7XG4gICAgICBpZiAodGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltUHJvbWlzZSA9PT0gcmVjbGFpbSkge1xuICAgICAgICB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1Qcm9taXNlID0gdW5kZWZpbmVkXG4gICAgICB9XG4gICAgfVxuICAgIHZvaWQgcmVjbGFpbS50aGVuKGNsZWFyUmVjbGFpbSwgY2xlYXJSZWNsYWltKVxuXG4gICAgcmV0dXJuIHJlY2xhaW1cbiAgfVxuXG4gIC8qKlxuICAgKiBXYWl0cyBmb3IgYW4gYWxyZWFkeS1zdGFydGVkIHN0YXJ0dXAgcmVjbGFpbSBiZWZvcmUgYWRhcHRlciBzaHV0ZG93bi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBubyBwYXNzIHJlbWFpbnMuXG4gICAqL1xuICBhc3luYyBfZHJhaW5TdGFydHVwSGFuZG9mZlJlY2xhaW0oKSB7XG4gICAgd2hpbGUgKHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVByb21pc2UpIHtcbiAgICAgIGF3YWl0IHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVByb21pc2VcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogT3JwaGFucyBvbmx5IHN0YXJ0dXAtc25hcHNob3R0ZWQgbGVhc2VzIHdob3NlIHN0YWJsZSB3b3JrZXIgaWQgaGFzIG5vdCBiZWVuXG4gICAqIG9ic2VydmVkIGJ5IHRoaXMgbWFpbiBnZW5lcmF0aW9uLiBTdG9yZSBmZW5jaW5nIHJlamVjdHMgY29tcGxldGVkLFxuICAgKiByZXR1cm5lZCwgcmVwbGFjZWQsIGFuZCByZS1oYW5kZWQtb2ZmIHJvd3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHJlY2xhaW0gb3IgcmV0YWluZWQgcmV0cnkgc3RhdGUuXG4gICAqL1xuICBhc3luYyBfcmVjbGFpbURpc2Nvbm5lY3RlZFN0YXJ0dXBIYW5kb2ZmcygpIHtcbiAgICBpZiAodGhpcy5fc3RvcHBlZCB8fCAhdGhpcy5fc3RhcnR1cEhhbmRvZmZHcmFjZUVsYXBzZWQpIHJldHVyblxuICAgIGlmICh0aGlzLnN0YXJ0dXBIYW5kb2ZmU25hcHNob3QubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIGF3YWl0IHRoaXMuX3dhaXRGb3JTdGFydHVwSGFuZG9mZkFkb3B0aW9uc0F0RGVhZGxpbmUoKVxuICAgIGlmICh0aGlzLl9zdG9wcGVkKSByZXR1cm5cblxuICAgIGNvbnN0IGhhbmRvZmZzID0gdGhpcy5zdGFydHVwSGFuZG9mZlNuYXBzaG90LmZpbHRlcigoe3dvcmtlcklkfSkgPT4gIXRoaXMucmVjb25uZWN0ZWRXb3JrZXJJZHMuaGFzKHdvcmtlcklkKSlcblxuICAgIGlmIChoYW5kb2Zmcy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRoaXMuc3RhcnR1cEhhbmRvZmZTbmFwc2hvdCA9IFtdXG4gICAgICB0aGlzLl9tYXliZVN0b3BSZXRpcmVkKClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGxldCBvcnBoYW5lZEpvYnNcblxuICAgIHRyeSB7XG4gICAgICBvcnBoYW5lZEpvYnMgPSBhd2FpdCB0aGlzLnN0b3JlLm1hcmtPcnBoYW5lZEhhbmRvZmZzKHtcbiAgICAgICAgZXJyb3I6IFwiSm9iIG9ycGhhbmVkIGFmdGVyIGl0cyBwcmUtcmVzdGFydCB3b3JrZXIgZGlkIG5vdCByZWNvbm5lY3RcIixcbiAgICAgICAgaGFuZG9mZnNcbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuX3JlcG9ydFN0YXJ0dXBIYW5kb2ZmUmVjbGFpbUVycm9yKGVycm9yKVxuICAgICAgdGhpcy5fc2NoZWR1bGVFcnJvclJldHJ5KClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuc3RhcnR1cEhhbmRvZmZTbmFwc2hvdCA9IFtdXG4gICAgYXdhaXQgdGhpcy5faGFuZGxlT3JwaGFuZWRKb2JzKHtcbiAgICAgIGpvYnM6IG9ycGhhbmVkSm9icyxcbiAgICAgIHdhcm5pbmc6IFwiUmVjbGFpbWVkIGJhY2tncm91bmQgam9icyBmcm9tIHdvcmtlcnMgYWJzZW50IGFmdGVyIG1haW4gcmVzdGFydCBncmFjZVwiXG4gICAgfSlcbiAgICB0aGlzLm9uU3RhcnR1cEhhbmRvZmZzUmVjbGFpbWVkPy4ob3JwaGFuZWRKb2JzKVxuICAgIHRoaXMuX21heWJlU3RvcFJldGlyZWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIExldHMgYWRvcHRpb24gcXVlcmllcyBhbHJlYWR5IHJ1bm5pbmcgYXQgdGhlIHJlY29ubmVjdCBkZWFkbGluZSBzZXR0bGVcbiAgICogYmVmb3JlIHdvcmtlciBpZHMgYXJlIGZpbHRlcmVkLiBBIHNlY29uZCBib3VuZGVkIGdyYWNlIHByZXZlbnRzIGEgc3R1Y2tcbiAgICogYWRhcHRlciBxdWVyeSBmcm9tIGRlZmVycmluZyBzdGFydHVwIHJlY2xhaW0gZm9yZXZlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgZGVhZGxpbmUgc2V0IHNldHRsZXMgb3IgdGltZXMgb3V0LlxuICAgKi9cbiAgYXN5bmMgX3dhaXRGb3JTdGFydHVwSGFuZG9mZkFkb3B0aW9uc0F0RGVhZGxpbmUoKSB7XG4gICAgY29uc3QgYWRvcHRpb25zID0gdGhpcy5fc3RhcnR1cEhhbmRvZmZBZG9wdGlvbnNBdERlYWRsaW5lXG5cbiAgICB0aGlzLl9zdGFydHVwSGFuZG9mZkFkb3B0aW9uc0F0RGVhZGxpbmUgPSBbXVxuICAgIGlmIChhZG9wdGlvbnMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IHRpbWVyXG4gICAgY29uc3Qgd2FpdExpbWl0ID0gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIC8vIFRoaXMgbGlmZWN5Y2xlIGRlYWRsaW5lIG11c3Qgbm90IGtlZXAgdGhlIG1haW4gcHJvY2VzcyBhbGl2ZTsgdGhlXG4gICAgICAvLyBnZW5lcmljIHRpbWVvdXQgaGVscGVyIGludGVudGlvbmFsbHkgdXNlcyBhIHJlZmVyZW5jZWQgdGltZXIuXG4gICAgICB0aW1lciA9IHNldFRpbWVvdXQocmVzb2x2ZSwgdGhpcy53b3JrZXJSZWNvbm5lY3RHcmFjZU1zKVxuICAgICAgdGltZXIudW5yZWYoKVxuICAgIH0pXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgUHJvbWlzZS5yYWNlKFtQcm9taXNlLmFsbChhZG9wdGlvbnMpLCB3YWl0TGltaXRdKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAodGltZXIpIGNsZWFyVGltZW91dCh0aW1lcilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUHVibGlzaGVzIGEgZGlzcGF0Y2ggd2FrZS11cCBvbiB0aGUgQmVhY29uIGNoYW5uZWwuIE5vLW9wIGluIHBvbGxpbmdcbiAgICogbW9kZSBvciB3aGVuIEJlYWNvbiBpcyBub3QgY29ubmVjdGVkOyBpbiB0aG9zZSBjYXNlcyB0aGUgZGlyZWN0XG4gICAqIGluLXByb2Nlc3MgYF9kcmFpbigpYCBjYWxsIGluIHRoZSBlbnF1ZXVlL2hhbmRsZSBwYXRocyBpcyBzdWZmaWNpZW50XG4gICAqICh0aGVyZSBhcmUgbm8gb3RoZXIgcHJvY2Vzc2VzIHRvIG5vdGlmeSkuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX25vdGlmeUVucXVldWVkKCkge1xuICAgIGlmICh0aGlzLmRpc3BhdGNoU3RyYXRlZ3kgPT09IFwicG9sbGluZ1wiKSByZXR1cm5cblxuICAgIGNvbnN0IGJlYWNvbkNsaWVudCA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCZWFjb25DbGllbnQoKVxuICAgIGlmICghYmVhY29uQ2xpZW50IHx8ICFiZWFjb25DbGllbnQuaXNDb25uZWN0ZWQoKSkgcmV0dXJuXG5cbiAgICB0cnkge1xuICAgICAgYmVhY29uQ2xpZW50LnB1Ymxpc2goe1xuICAgICAgICBjaGFubmVsOiBESVNQQVRDSF9DSEFOTkVMLFxuICAgICAgICBicm9hZGNhc3RQYXJhbXM6IHt9LFxuICAgICAgICBib2R5OiB7YWN0aW9uOiBcIndha2VcIn1cbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oKCkgPT4gW1wiRmFpbGVkIHRvIHB1Ymxpc2ggYmFja2dyb3VuZCBqb2JzIHdha2UgYnJvYWRjYXN0OlwiLCBlcnJvcl0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibmV0XCIpLlNvY2tldH0gc29ja2V0IC0gU29ja2V0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9oYW5kbGVDb25uZWN0aW9uKHNvY2tldCkge1xuICAgIGNvbnN0IGpzb25Tb2NrZXQgPSBuZXcgSnNvblNvY2tldChzb2NrZXQpXG4gICAgdGhpcy5jb25uZWN0aW9ucy5hZGQoanNvblNvY2tldClcbiAgICAvKipcbiAgICAgKiBSb2xlLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTb2NrZXRSb2xlIHwgbnVsbH0gKi9cbiAgICBsZXQgcm9sZSA9IG51bGxcblxuICAgIGxldCBjbGVhbmVkVXAgPSBmYWxzZVxuICAgIGNvbnN0IGNsZWFudXAgPSAoKSA9PiB7XG4gICAgICBpZiAoY2xlYW5lZFVwKSByZXR1cm5cbiAgICAgIGNsZWFuZWRVcCA9IHRydWVcbiAgICAgIHRoaXMuY29ubmVjdGlvbnMuZGVsZXRlKGpzb25Tb2NrZXQpXG5cbiAgICAgIGlmIChyb2xlID09PSBcIndvcmtlclwiKSB2b2lkIHRoaXMuX2hhbmRsZVdvcmtlclNvY2tldENsb3NlZChqc29uU29ja2V0KVxuICAgICAgdGhpcy5fbWF5YmVTdG9wUmV0aXJlZCgpXG4gICAgfVxuXG4gICAganNvblNvY2tldC5vbihcImNsb3NlXCIsIGNsZWFudXApXG4gICAganNvblNvY2tldC5vbihcImVycm9yXCIsIChlcnJvcikgPT4ge1xuICAgICAgdGhpcy5sb2dnZXIud2FybigoKSA9PiBbXCJCYWNrZ3JvdW5kIGpvYnMgY29ubmVjdGlvbiBlcnJvcjpcIiwgZXJyb3JdKVxuICAgICAgY2xlYW51cCgpXG4gICAgfSlcblxuICAgIGxldCBtZXNzYWdlSGFuZGxpbmcgPSBQcm9taXNlLnJlc29sdmUoKVxuICAgIGpzb25Tb2NrZXQub24oXCJtZXNzYWdlXCIsIChtZXNzYWdlKSA9PiB7XG4gICAgICBtZXNzYWdlSGFuZGxpbmcgPSBtZXNzYWdlSGFuZGxpbmcudGhlbihhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGV4aXN0aW5nUm9sZSA9IHJvbGVcbiAgICAgICAgcm9sZSA9IGF3YWl0IHRoaXMuX2hhbmRsZVNvY2tldE1lc3NhZ2Uoe2pzb25Tb2NrZXQsIG1lc3NhZ2UsIHJvbGV9KVxuICAgICAgICBpZiAoZXhpc3RpbmdSb2xlID09PSBcImNsaWVudFwiIHx8IGV4aXN0aW5nUm9sZSA9PT0gXCJyZXBvcnRlclwiKSBqc29uU29ja2V0LmNsb3NlKClcbiAgICAgIH0pLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgICB0aGlzLl9yZXBvcnRDb25uZWN0aW9uSGFuZGxlckVycm9yKGVycm9yKVxuICAgICAgICBqc29uU29ja2V0LmNsb3NlKClcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTdXJmYWNlcyBhbiB1bmV4cGVjdGVkIHByb3RvY29sLWhhbmRsZXIgZmFpbHVyZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBIYW5kbGVyIGZhaWx1cmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlcG9ydENvbm5lY3Rpb25IYW5kbGVyRXJyb3IoZXJyb3IpIHtcbiAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICBjb25zdCBwYXlsb2FkID0ge2NvbnRleHQ6IHtzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYnMtc29ja2V0LWhhbmRsZXJcIn0sIGVycm9yOiBub3JtYWxpemVkRXJyb3J9XG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiQmFja2dyb3VuZCBqb2JzIHNvY2tldCBoYW5kbGVyIGZhaWxlZDpcIiwgbm9ybWFsaXplZEVycm9yXSlcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiZnJhbWV3b3JrLWVycm9yXCIsIHBheWxvYWQpXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4ucGF5bG9hZCwgZXJyb3JUeXBlOiBcImZyYW1ld29yay1lcnJvclwifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBzb2NrZXQgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNvY2tldE1lc3NhZ2V9IGFyZ3MubWVzc2FnZSAtIFNvY2tldCBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNvY2tldFJvbGUgfCBudWxsfSBhcmdzLnJvbGUgLSBDdXJyZW50IHNvY2tldCByb2xlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTb2NrZXRSb2xlIHwgbnVsbD59IC0gVXBkYXRlZCBzb2NrZXQgcm9sZS5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVTb2NrZXRNZXNzYWdlKHtqc29uU29ja2V0LCBtZXNzYWdlLCByb2xlfSkge1xuICAgIGlmICghcm9sZSkgcmV0dXJuIGF3YWl0IHRoaXMuX2hhbmRsZVJvbGVsZXNzU29ja2V0TWVzc2FnZSh7anNvblNvY2tldCwgbWVzc2FnZX0pXG4gICAgaWYgKHJvbGUgPT09IFwid29ya2VyXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZVdvcmtlclNvY2tldE1lc3NhZ2Uoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KVxuICAgICAgcmV0dXJuIHJvbGVcbiAgICB9XG5cbiAgICB0aGlzLl9hY3RpdmVOb25Xb3JrZXJSZXF1ZXN0cyArPSAxXG4gICAgdHJ5IHtcbiAgICAgIGlmIChyb2xlID09PSBcImNsaWVudFwiKSBhd2FpdCB0aGlzLl9oYW5kbGVDbGllbnRTb2NrZXRNZXNzYWdlKHtqc29uU29ja2V0LCBtZXNzYWdlfSlcbiAgICAgIGlmIChyb2xlID09PSBcInJlcG9ydGVyXCIpIGF3YWl0IHRoaXMuX2hhbmRsZVJlcG9ydGVyU29ja2V0TWVzc2FnZSh7anNvblNvY2tldCwgbWVzc2FnZX0pXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX2FjdGl2ZU5vbldvcmtlclJlcXVlc3RzIC09IDFcbiAgICAgIHRoaXMuX21heWJlU3RvcFJldGlyZWQoKVxuICAgIH1cblxuICAgIHJldHVybiByb2xlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgcm9sZWxlc3Mgc29ja2V0IG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLmpzb25Tb2NrZXQgLSBKU09OIHNvY2tldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTb2NrZXRNZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBTb2NrZXQgbWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU29ja2V0Um9sZSB8IG51bGw+fSAtIE5ldyBzb2NrZXQgcm9sZS5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVSb2xlbGVzc1NvY2tldE1lc3NhZ2Uoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KSB7XG4gICAgaWYgKG1lc3NhZ2U/LnR5cGUgIT09IFwiaGVsbG9cIikgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHJlamVjdGlvblJlYXNvbiA9IHRoaXMuX2dlbmVyYXRpb25IZWxsb1JlamVjdGlvblJlYXNvbihtZXNzYWdlKVxuXG4gICAgaWYgKHJlamVjdGlvblJlYXNvbikge1xuICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImdlbmVyYXRpb24tcmVqZWN0ZWRcIiwgcmVhc29uOiByZWplY3Rpb25SZWFzb259KVxuICAgICAganNvblNvY2tldC5jbG9zZSgpXG4gICAgICByZXR1cm4gbnVsbFxuICAgIH1cblxuICAgIGlmIChtZXNzYWdlLnJvbGUgPT09IFwid29ya2VyXCIpIHtcbiAgICAgIGlmICh0aGlzLl9zdG9wcGVkKSB7XG4gICAgICAgIGpzb25Tb2NrZXQuY2xvc2UoKVxuICAgICAgICByZXR1cm4gbWVzc2FnZS5yb2xlXG4gICAgICB9XG5cbiAgICAgIGlmICghKGF3YWl0IHRoaXMuX3JlZ2lzdGVyV29ya2VyKHtqc29uU29ja2V0LCBtZXNzYWdlfSkpKSByZXR1cm4gbnVsbFxuICAgIH1cblxuICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCkge1xuICAgICAganNvblNvY2tldC5zZW5kKHtcbiAgICAgICAgdHlwZTogXCJnZW5lcmF0aW9uLWFjY2VwdGVkXCIsXG4gICAgICAgIGdlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWQsXG4gICAgICAgIGxpZmVjeWNsZVN0YXRlOiB0aGlzLmxpZmVjeWNsZVN0YXRlXG4gICAgICB9KVxuICAgICAgaWYgKG1lc3NhZ2Uucm9sZSA9PT0gXCJ3b3JrZXJcIiAmJiAodGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJyZXRpcmluZ1wiIHx8IHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwicmV0aXJlZFwiKSkge1xuICAgICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwicmV0aXJlXCIsIGdlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWR9KVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBtZXNzYWdlLnJvbGVcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgdGhlIGdlbmVyYXRpb24gZmVuY2UgYmVmb3JlIGFzc2lnbmluZyBhIHNvY2tldCByb2xlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhlbGxvTWVzc2FnZX0gbWVzc2FnZSAtIEhlbGxvIG1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JzR2VuZXJhdGlvblJlamVjdGlvblJlYXNvbiB8IG51bGx9IC0gUmVqZWN0aW9uIHJlYXNvbi5cbiAgICovXG4gIF9nZW5lcmF0aW9uSGVsbG9SZWplY3Rpb25SZWFzb24obWVzc2FnZSkge1xuICAgIGNvbnN0IG1lc3NhZ2VIYXNHZW5lcmF0aW9uID0gT2JqZWN0Lmhhc093bihtZXNzYWdlLCBcImdlbmVyYXRpb25JZFwiKVxuXG4gICAgaWYgKCF0aGlzLmdlbmVyYXRpb25JZCkgcmV0dXJuIG1lc3NhZ2VIYXNHZW5lcmF0aW9uID8gXCJ1bmV4cGVjdGVkLWdlbmVyYXRpb25cIiA6IG51bGxcbiAgICBpZiAoIW1lc3NhZ2VIYXNHZW5lcmF0aW9uKSByZXR1cm4gXCJtaXNzaW5nLWdlbmVyYXRpb25cIlxuXG4gICAgdHJ5IHtcbiAgICAgIHZhbGlkYXRlR2VuZXJhdGlvbklkKG1lc3NhZ2UuZ2VuZXJhdGlvbklkLCBcImhlbGxvIGdlbmVyYXRpb25JZFwiKVxuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIFwibWFsZm9ybWVkLWdlbmVyYXRpb25cIlxuICAgIH1cblxuICAgIGlmIChtZXNzYWdlLmdlbmVyYXRpb25JZCAhPT0gdGhpcy5nZW5lcmF0aW9uSWQpIHJldHVybiBcImdlbmVyYXRpb24tbWlzbWF0Y2hcIlxuICAgIGlmIChtZXNzYWdlLnJvbGUgPT09IFwid29ya2VyXCIgJiYgIXdvcmtlcklkQmVsb25nc1RvR2VuZXJhdGlvbih7Z2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZCwgd29ya2VySWQ6IG1lc3NhZ2Uud29ya2VySWR9KSkge1xuICAgICAgcmV0dXJuIFwiZ2VuZXJhdGlvbi1taXNtYXRjaFwiXG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSBnZW5lcmF0aW9uLWZlbmNlZCB3b3JrZXIgYW5kIHRyYW5zZmVycyBvbmx5IGl0cyBleGFjdCBvd25lcnNoaXAuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gV29ya2VyIGhlbGxvLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIE5ldyBzb2NrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGVsbG9NZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBIZWxsby5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgd29ya2VyIHdhcyBhZG1pdHRlZC5cbiAgICovXG4gIGFzeW5jIF9yZWdpc3Rlcldvcmtlcih7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICBqc29uU29ja2V0LndvcmtlcklkID0gbWVzc2FnZS53b3JrZXJJZFxuICAgIGpzb25Tb2NrZXQuc3VwcG9ydHNIYW5kb2ZmSWRSZXBvcnRpbmcgPSBtZXNzYWdlLnN1cHBvcnRzSGFuZG9mZklkUmVwb3J0aW5nID09PSB0cnVlXG4gICAganNvblNvY2tldC5zdXBwb3J0c0hlYXJ0YmVhdCA9IG1lc3NhZ2Uuc3VwcG9ydHNIZWFydGJlYXQgPT09IHRydWVcbiAgICBqc29uU29ja2V0Lmxhc3RTZWVuQXQgPSB0aGlzLmNsb2NrLm5vdygpXG5cbiAgICBjb25zdCB3b3JrZXJJZCA9IGpzb25Tb2NrZXQud29ya2VySWRcbiAgICBjb25zdCBkaXNjb25uZWN0ZWQgPSB3b3JrZXJJZCA/IHRoaXMuZGlzY29ubmVjdGVkV29ya2Vycy5nZXQod29ya2VySWQpIDogdW5kZWZpbmVkXG4gICAgbGV0IGhhbmRvZmZzID0gZGlzY29ubmVjdGVkID8gdGhpcy53b3JrZXJIYW5kb2Zmcy5nZXQoZGlzY29ubmVjdGVkLndvcmtlcikgOiB1bmRlZmluZWRcbiAgICBjb25zdCByZWNvdmVyeU9ubHkgPSB0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcInJldGlyaW5nXCIgfHwgdGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJyZXRpcmVkXCJcblxuICAgIGlmIChyZWNvdmVyeU9ubHkgJiYgKCFoYW5kb2ZmcyB8fCBoYW5kb2Zmcy5zaXplID09PSAwKSkge1xuICAgICAgaWYgKCF3b3JrZXJJZCkgcmV0dXJuIGZhbHNlXG4gICAgICBjb25zdCBkdXJhYmxlSGFuZG9mZnMgPSBhd2FpdCB0aGlzLnN0b3JlLmhhbmRlZE9mZkpvYnNGb3JXb3JrZXIoe3dvcmtlcklkfSlcblxuICAgICAgaWYgKGR1cmFibGVIYW5kb2Zmcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImdlbmVyYXRpb24tcmVqZWN0ZWRcIiwgcmVhc29uOiBcIndvcmtlci1oYXMtbm8tcmVjb3ZlcmFibGUtaGFuZG9mZnNcIn0pXG4gICAgICAgIGpzb25Tb2NrZXQuY2xvc2UoKVxuICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgIH1cblxuICAgICAgaGFuZG9mZnMgPSBuZXcgTWFwKGR1cmFibGVIYW5kb2Zmcy5tYXAoKHtqb2JJZCwgaGFuZG9mZklkfSkgPT4gW2pvYklkLCBoYW5kb2ZmSWRdKSlcbiAgICAgIHRoaXMucmVjb25uZWN0ZWRXb3JrZXJJZHMuYWRkKHdvcmtlcklkKVxuICAgIH1cblxuICAgIGlmIChkaXNjb25uZWN0ZWQpIHtcbiAgICAgIHRoaXMuY2xvY2suY2xlYXJUaW1lb3V0KGRpc2Nvbm5lY3RlZC50aW1lcilcbiAgICAgIGlmICh3b3JrZXJJZCkgdGhpcy5kaXNjb25uZWN0ZWRXb3JrZXJzLmRlbGV0ZSh3b3JrZXJJZClcbiAgICAgIHRoaXMud29ya2VySGFuZG9mZnMuZGVsZXRlKGRpc2Nvbm5lY3RlZC53b3JrZXIpXG4gICAgfVxuXG4gICAgdGhpcy53b3JrZXJzLmFkZChqc29uU29ja2V0KVxuICAgIHRoaXMud29ya2VySGFuZG9mZnMuc2V0KGpzb25Tb2NrZXQsIGhhbmRvZmZzIHx8IG5ldyBNYXAoKSlcbiAgICBpZiAocmVjb3ZlcnlPbmx5KSBqc29uU29ja2V0LmlzRHJhaW5pbmcgPSB0cnVlXG4gICAgaWYgKCFoYW5kb2ZmcyAmJiB0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcImFjdGl2ZVwiKSB0aGlzLl90cmFja1dvcmtlckhhbmRvZmZBZG9wdGlvbihqc29uU29ja2V0KVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBUcmFja3MgYSB3b3JrZXIgaGFuZG9mZi1hZG9wdGlvbiBxdWVyeSB0aHJvdWdoIHNodXRkb3duLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGpzb25Tb2NrZXQgLSBSZWNvbm5lY3Rpbmcgd29ya2VyIHNvY2tldC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfdHJhY2tXb3JrZXJIYW5kb2ZmQWRvcHRpb24oanNvblNvY2tldCkge1xuICAgIGNvbnN0IGFkb3B0aW9uID0gdGhpcy5fYWRvcHRXb3JrZXJIYW5kb2Zmcyhqc29uU29ja2V0KVxuICAgIHRoaXMuaW5mbGlnaHRXb3JrZXJIYW5kb2ZmQWRvcHRpb25zLmFkZChhZG9wdGlvbilcbiAgICBjb25zdCByZW1vdmVBZG9wdGlvbiA9ICgpID0+IHtcbiAgICAgIHRoaXMuaW5mbGlnaHRXb3JrZXJIYW5kb2ZmQWRvcHRpb25zLmRlbGV0ZShhZG9wdGlvbilcbiAgICAgIHRoaXMuX21heWJlU3RvcFJldGlyZWQoKVxuICAgIH1cbiAgICB2b2lkIGFkb3B0aW9uLnRoZW4ocmVtb3ZlQWRvcHRpb24sIHJlbW92ZUFkb3B0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFdhaXRzIGZvciB3b3JrZXIgaGFuZG9mZi1hZG9wdGlvbiBxdWVyaWVzIHRvIGZpbmlzaC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBubyBhZG9wdGlvbiBxdWVyeSByZW1haW5zLlxuICAgKi9cbiAgYXN5bmMgX2RyYWluV29ya2VySGFuZG9mZkFkb3B0aW9ucygpIHtcbiAgICB3aGlsZSAodGhpcy5pbmZsaWdodFdvcmtlckhhbmRvZmZBZG9wdGlvbnMuc2l6ZSA+IDApIHtcbiAgICAgIGF3YWl0IFByb21pc2UuYWxsKFsuLi50aGlzLmluZmxpZ2h0V29ya2VySGFuZG9mZkFkb3B0aW9uc10pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFkb3B0cyBhIHJlY29ubmVjdGluZyB3b3JrZXIncyBzdGlsbC1hY3RpdmUgYGhhbmRlZF9vZmZgIGpvYnMgaW50byBpdHMgbmV3XG4gICAqIHNvY2tldCdzIGhhbmRvZmYgbWFwLiBBIGZyZXNoIG1haW4gKGUuZy4gYWZ0ZXIgYSBkZXBsb3kgcmVzdGFydCkgaG9sZHMgbm9cbiAgICogaW4tbWVtb3J5IGxlYXNlcywgc28gYSB3b3JrZXIgdGhhdCByZWNvbm5lY3RzIHdpdGggaXRzIHN0YWJsZSBpZCB3b3VsZFxuICAgKiBvdGhlcndpc2UgaGF2ZSBpdHMgcHJlLXJlc3RhcnQgam9icyB0cmFja2VkIG5vd2hlcmUg4oCUIGlmIGl0IHRoZW4gZGllZCwgdGhvc2VcbiAgICogbGVhc2VzIChhbmQgdGhlaXIgY29uY3VycmVuY3kgcmVzZXJ2YXRpb25zKSB3b3VsZCBzaXQgc3R1Y2sgdW50aWwgdGhlXG4gICAqIGhvdXJzLWxvbmcgb3JwaGFuIHN3ZWVwLiBBZG9wdGluZyB0aGVtIG1lYW5zIGBfaGFuZGxlV29ya2VyU29ja2V0Q2xvc2VkYFxuICAgKiByZWxlYXNlcyB0aGVtIG9uIHRoZSB3b3JrZXIncyBuZXh0IGRpc2Nvbm5lY3QsIHdoaWxlIGEgc3RpbGwtcnVubmluZyB3b3JrZXJcbiAgICogKGluY2x1ZGluZyBvbmUgZ3JhY2VmdWxseSBkcmFpbmluZykga2VlcHMgZXhlY3V0aW5nIHRoZW0gdW50b3VjaGVkLiBOb1xuICAgKiB0aW1lLWJhc2VkIHJlY2xhaW0gaXMgdXNlZCwgc28gYSBkcmFpbmluZyB3b3JrZXIgd2hvc2Ugam9icyBvdXRsaXZlIHRoZSBvbGRcbiAgICogbWFpbiBpcyBuZXZlciB3cm9uZ2x5IHJlcXVldWVkIGludG8gYSBkdXBsaWNhdGUgYXR0ZW1wdC5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBqc29uU29ja2V0IC0gVGhlIHJlY29ubmVjdGVkIHdvcmtlciBzb2NrZXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2Fkb3B0V29ya2VySGFuZG9mZnMoanNvblNvY2tldCkge1xuICAgIGNvbnN0IHdvcmtlcklkID0ganNvblNvY2tldC53b3JrZXJJZFxuXG4gICAgaWYgKHR5cGVvZiB3b3JrZXJJZCAhPT0gXCJzdHJpbmdcIiB8fCB3b3JrZXJJZC5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGhhbmRvZmZzID0gYXdhaXQgdGhpcy5zdG9yZS5oYW5kZWRPZmZKb2JzRm9yV29ya2VyKHt3b3JrZXJJZH0pXG4gICAgICBjb25zdCBtYXAgPSB0aGlzLndvcmtlckhhbmRvZmZzLmdldChqc29uU29ja2V0KVxuXG4gICAgICAvLyBUaGUgc29ja2V0IG1heSBoYXZlIGNsb3NlZCB3aGlsZSB0aGUgcXVlcnkgd2FzIGluIGZsaWdodDsgaXRzIG1hcCBpcyB0aGVuXG4gICAgICAvLyBnb25lIGFuZCB0aGUgam9icyBhcmUgbGVmdCBmb3IgdGhlIG9ycGhhbiBzd2VlcCByYXRoZXIgdGhhbiByZXN1cnJlY3RlZC5cbiAgICAgIGlmICghbWFwIHx8ICF0aGlzLndvcmtlcnMuaGFzKGpzb25Tb2NrZXQpKSByZXR1cm5cblxuICAgICAgZm9yIChjb25zdCB7am9iSWQsIGhhbmRvZmZJZH0gb2YgaGFuZG9mZnMpIHtcbiAgICAgICAgbWFwLnNldChqb2JJZCwgaGFuZG9mZklkKVxuICAgICAgfVxuICAgICAgdGhpcy5yZWNvbm5lY3RlZFdvcmtlcklkcy5hZGQod29ya2VySWQpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuX3JlcG9ydEhhbmRvZmZBZG9wdEVycm9yKGVycm9yKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBjbGllbnQgc29ja2V0IG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLmpzb25Tb2NrZXQgLSBKU09OIHNvY2tldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTb2NrZXRNZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBTb2NrZXQgbWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHJlcXVlc3QgaXMgYWNrbm93bGVkZ2VkLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZUNsaWVudFNvY2tldE1lc3NhZ2Uoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KSB7XG4gICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkICYmICh0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcInJldGlyaW5nXCIgfHwgdGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJyZXRpcmVkXCIpKSB7XG4gICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJlbnF1ZXVlXCIgJiYgIW1lc3NhZ2UucHJvZHVjZXJQcm9vZikganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImVucXVldWUtZXJyb3JcIiwgZXJyb3I6IFwiQmFja2dyb3VuZCBqb2JzIGdlbmVyYXRpb24gaXMgcmV0aXJlZFwifSlcbiAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcInJlcGxhY2Utc2NoZWR1bGVkXCIpIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJyZXBsYWNlLXNjaGVkdWxlZC1lcnJvclwiLCBlcnJvcjogXCJCYWNrZ3JvdW5kIGpvYnMgZ2VuZXJhdGlvbiBpcyByZXRpcmVkXCJ9KVxuICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiY2FuY2VsLXNjaGVkdWxlZFwiKSBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiY2FuY2VsLXNjaGVkdWxlZC1lcnJvclwiLCBlcnJvcjogXCJCYWNrZ3JvdW5kIGpvYnMgZ2VuZXJhdGlvbiBpcyByZXRpcmVkXCJ9KVxuICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiZ2V0LXNjaGVkdWxlZC1qb2JcIikganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImdldC1zY2hlZHVsZWQtam9iLWVycm9yXCIsIGVycm9yOiBcIkJhY2tncm91bmQgam9icyBnZW5lcmF0aW9uIGlzIHJldGlyZWRcIn0pXG4gICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJ3YWtlLXNjaGVkdWxlZFwiKSBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwid2FrZS1zY2hlZHVsZWQtZXJyb3JcIiwgZXJyb3I6IFwiQmFja2dyb3VuZCBqb2JzIGdlbmVyYXRpb24gaXMgcmV0aXJlZFwifSlcbiAgICAgIGlmIChtZXNzYWdlPy50eXBlICE9PSBcImVucXVldWVcIiB8fCAhbWVzc2FnZS5wcm9kdWNlclByb29mKSByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJlbnF1ZXVlXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZUVucXVldWUoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwicmVwbGFjZS1zY2hlZHVsZWRcIikge1xuICAgICAgYXdhaXQgdGhpcy5faGFuZGxlUmVwbGFjZVNjaGVkdWxlZCh7anNvblNvY2tldCwgbWVzc2FnZX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJjYW5jZWwtc2NoZWR1bGVkXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZUNhbmNlbFNjaGVkdWxlZCh7anNvblNvY2tldCwgbWVzc2FnZX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJnZXQtc2NoZWR1bGVkLWpvYlwiKSB7XG4gICAgICBhd2FpdCB0aGlzLl9oYW5kbGVHZXRTY2hlZHVsZWRKb2Ioe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwid2FrZS1zY2hlZHVsZWRcIikge1xuICAgICAgYXdhaXQgdGhpcy5faGFuZGxlV2FrZVNjaGVkdWxlZCh7anNvblNvY2tldCwgbWVzc2FnZX0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIHdvcmtlciBzb2NrZXQgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNvY2tldE1lc3NhZ2V9IGFyZ3MubWVzc2FnZSAtIFNvY2tldCBtZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgd29ya2VyIG1lc3NhZ2UgaXMgaGFuZGxlZC5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVXb3JrZXJTb2NrZXRNZXNzYWdlKHtqc29uU29ja2V0LCBtZXNzYWdlfSkge1xuICAgIC8vIEFueSBtZXNzYWdlIGZyb20gdGhlIHdvcmtlciBwcm92ZXMgaXQgaXMgYWxpdmU7IHRoZSBsaXZlbmVzcyBzd2VlcCB1c2VzXG4gICAgLy8gdGhpcyB0byBkZXRlY3QgYSB3ZWRnZWQvc2lsZW50IHdvcmtlci5cbiAgICBqc29uU29ja2V0Lmxhc3RTZWVuQXQgPSB0aGlzLmNsb2NrLm5vdygpXG5cbiAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJoZWFydGJlYXRcIikge1xuICAgICAgdGhpcy5vbldvcmtlckhlYXJ0YmVhdD8uKGpzb25Tb2NrZXQpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJyZWFkeVwiKSB7XG4gICAgICB0aGlzLl9oYW5kbGVXb3JrZXJSZWFkeSh7anNvblNvY2tldCwgbWVzc2FnZX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJkcmFpbmluZ1wiKSB7XG4gICAgICB0aGlzLl9oYW5kbGVXb3JrZXJEcmFpbmluZyh7anNvblNvY2tldH0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLl9oYW5kbGVSZXBvcnRlclNvY2tldE1lc3NhZ2Uoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIHJlcG9ydGVyIHNvY2tldCBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy5qc29uU29ja2V0IC0gSlNPTiBzb2NrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU29ja2V0TWVzc2FnZX0gYXJncy5tZXNzYWdlIC0gU29ja2V0IG1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSByZXBvcnQgaXMgYWNrbm93bGVkZ2VkLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZVJlcG9ydGVyU29ja2V0TWVzc2FnZSh7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQgJiYgdGhpcy5fZ2VuZXJhdGlvblJlcG9ydElzSW52YWxpZChtZXNzYWdlKSkge1xuICAgICAgaWYgKFwiam9iSWRcIiBpbiBtZXNzYWdlICYmIHR5cGVvZiBtZXNzYWdlLmpvYklkID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJqb2ItdXBkYXRlLWVycm9yXCIsIGpvYklkOiBtZXNzYWdlLmpvYklkLCBlcnJvcjogXCJHZW5lcmF0aW9uIG93bmVyc2hpcCByZWplY3RlZFwifSlcbiAgICAgIH1cbiAgICAgIHJldHVyblxuICAgIH1cbiAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJqb2ItYWNjZXB0ZWRcIikge1xuICAgICAgYXdhaXQgdGhpcy5faGFuZGxlSm9iQWNjZXB0ZWQoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiam9iLWNvbXBsZXRlXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZUpvYkNvbXBsZXRlKHtqc29uU29ja2V0LCBtZXNzYWdlfSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImpvYi1mYWlsZWRcIikge1xuICAgICAgYXdhaXQgdGhpcy5faGFuZGxlSm9iRmFpbGVkKHtqc29uU29ja2V0LCBtZXNzYWdlfSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImpvYi1yZXNjaGVkdWxlXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZUpvYlJlc2NoZWR1bGUoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJzaXN0cyBwb29sZWQtY2hpbGQgYWNjZXB0YW5jZSBldmlkZW5jZSBmb3IgYW4gYWN0aXZlIGhhbmRvZmYuIFRoZVxuICAgKiByZXBvcnQgaXMgZGlhZ25vc3RpYzogYSBzdGFsZSBsZWFzZSAoam9iIGFscmVhZHkgcmVjbGFpbWVkIG9yIHRlcm1pbmFsKVxuICAgKiBhbnN3ZXJzIHRoZSBzYW1lIGBqb2ItdXBkYXRlZGAgYWNrbm93bGVkZ2VtZW50IGFzIGFuIGFjY2VwdGVkIHJlcG9ydCwgYW5kXG4gICAqIG9ubHkgYSBzdG9yZSBmYWlsdXJlIGFuc3dlcnMgYGpvYi11cGRhdGUtZXJyb3JgIHNvIHRoZSB3b3JrZXIgY2FuIHJldHJ5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy5qc29uU29ja2V0IC0gSlNPTiBzb2NrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iQWNjZXB0ZWRNZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBNZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGhhbmRsZWQuXG4gICAqL1xuICBhc3luYyBfaGFuZGxlSm9iQWNjZXB0ZWQoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuc3RvcmUubWFya0NoaWxkQWNjZXB0ZWQoe1xuICAgICAgICBjaGlsZEluc3RhbmNlSWQ6IG1lc3NhZ2UuY2hpbGRJbnN0YW5jZUlkLFxuICAgICAgICBjaGlsZFBpZDogbWVzc2FnZS5jaGlsZFBpZCxcbiAgICAgICAgaGFuZGVkT2ZmQXRNczogbWVzc2FnZS5oYW5kZWRPZmZBdE1zLFxuICAgICAgICBoYW5kb2ZmSWQ6IG1lc3NhZ2UuaGFuZG9mZklkLFxuICAgICAgICBqb2JJZDogbWVzc2FnZS5qb2JJZCxcbiAgICAgICAgcmVjZWl2ZWRBdE1zOiBtZXNzYWdlLnJlY2VpdmVkQXRNcyxcbiAgICAgICAgcnVubmVySG9zdG5hbWU6IG1lc3NhZ2UucnVubmVySG9zdG5hbWUsXG4gICAgICAgIHN0YXJ0ZWRBdE1zOiBtZXNzYWdlLnN0YXJ0ZWRBdE1zLFxuICAgICAgICB3b3JrZXJJZDogbWVzc2FnZS53b3JrZXJJZFxuICAgICAgfSlcbiAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJqb2ItdXBkYXRlZFwiLCBqb2JJZDogbWVzc2FnZS5qb2JJZH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuX3JlcG9ydEpvYlVwZGF0ZUZhaWx1cmUoe2Vycm9yLCBqb2JJZDogbWVzc2FnZS5qb2JJZCwgc3RhZ2U6IFwiYmFja2dyb3VuZC1qb2ItYWNjZXB0ZWRcIn0pXG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiam9iLXVwZGF0ZS1lcnJvclwiLCBqb2JJZDogbWVzc2FnZS5qb2JJZCwgZXJyb3I6IFwiRmFpbGVkIHRvIHVwZGF0ZSBqb2JcIn0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcXVpcmVzIHRoZSBjb21wbGV0ZSBkdXJhYmxlIGxlYXNlIGlkZW50aXR5IGJlZm9yZSBhIGdlbmVyYXRpb24tbW9kZVxuICAgKiByZXBvcnRlciBjYW4gbXV0YXRlIGEgam9iLiBMZWdhY3kgcmVwb3J0ZXJzIGtlZXAgdGhlaXIgcGVybWlzc2l2ZSBwcm90b2NvbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTb2NrZXRNZXNzYWdlfSBtZXNzYWdlIC0gUmVwb3J0ZXIgbWVzc2FnZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgcmVwb3J0IGxhY2tzIGl0cyBleGFjdCBnZW5lcmF0aW9uIGxlYXNlLlxuICAgKi9cbiAgX2dlbmVyYXRpb25SZXBvcnRJc0ludmFsaWQobWVzc2FnZSkge1xuICAgIGlmIChtZXNzYWdlPy50eXBlICE9PSBcImpvYi1hY2NlcHRlZFwiICYmIG1lc3NhZ2U/LnR5cGUgIT09IFwiam9iLWNvbXBsZXRlXCIgJiYgbWVzc2FnZT8udHlwZSAhPT0gXCJqb2ItZmFpbGVkXCIgJiYgbWVzc2FnZT8udHlwZSAhPT0gXCJqb2ItcmVzY2hlZHVsZVwiKSByZXR1cm4gZmFsc2VcbiAgICBjb25zdCBnZW5lcmF0aW9uSWQgPSB0aGlzLmdlbmVyYXRpb25JZFxuICAgIGlmICghZ2VuZXJhdGlvbklkKSByZXR1cm4gZmFsc2VcblxuICAgIHJldHVybiB0eXBlb2YgbWVzc2FnZS5oYW5kb2ZmSWQgIT09IFwic3RyaW5nXCJcbiAgICAgIHx8IHR5cGVvZiBtZXNzYWdlLmhhbmRlZE9mZkF0TXMgIT09IFwibnVtYmVyXCJcbiAgICAgIHx8ICF3b3JrZXJJZEJlbG9uZ3NUb0dlbmVyYXRpb24oe2dlbmVyYXRpb25JZCwgd29ya2VySWQ6IG1lc3NhZ2Uud29ya2VySWR9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIHdvcmtlciByZWFkeS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJlYWR5TWVzc2FnZX0gYXJncy5tZXNzYWdlIC0gUmVhZHkgbWVzc2FnZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaGFuZGxlV29ya2VyUmVhZHkoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KSB7XG4gICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwicmV0aXJpbmdcIiB8fCB0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcInJldGlyZWRcIikge1xuICAgICAgdGhpcy5yZWFkeVdvcmtlcnMuZGVsZXRlKGpzb25Tb2NrZXQpXG4gICAgICB0aGlzLmNhbmRpZGF0ZVJlYWR5V29ya2Vycy5kZWxldGUoanNvblNvY2tldClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGpzb25Tb2NrZXQucmVhZGluZXNzVmVyc2lvbiArPSAxXG4gICAganNvblNvY2tldC5hY2NlcHRzU3Bhd25lZEpvYnMgPSBtZXNzYWdlLmFjY2VwdHNTcGF3bmVkICE9PSBmYWxzZSAmJiBtZXNzYWdlLmFjY2VwdHNGb3JrZWQgIT09IGZhbHNlXG4gICAganNvblNvY2tldC5hY2NlcHRzRm9ya2VkSm9icyA9IG1lc3NhZ2UuYWNjZXB0c0ZvcmtlZCAhPT0gZmFsc2VcbiAgICBqc29uU29ja2V0LmFjY2VwdHNQb29sZWRKb2JzID0gbWVzc2FnZS5hY2NlcHRzUG9vbGVkID09PSB0cnVlXG4gICAgY29uc3QgYXZhaWxhYmxlUG9vbGVkU2xvdHMgPSBtZXNzYWdlLmF2YWlsYWJsZVBvb2xlZFNsb3RzXG4gICAganNvblNvY2tldC51c2VzUG9vbGVkQ2FwYWNpdHlDcmVkaXRzID0gTnVtYmVyLmlzSW50ZWdlcihhdmFpbGFibGVQb29sZWRTbG90cylcbiAgICBqc29uU29ja2V0LmF2YWlsYWJsZVBvb2xlZFNsb3RzID0gTnVtYmVyLmlzSW50ZWdlcihhdmFpbGFibGVQb29sZWRTbG90cykgJiYgYXZhaWxhYmxlUG9vbGVkU2xvdHMgIT09IHVuZGVmaW5lZCAmJiBhdmFpbGFibGVQb29sZWRTbG90cyA+IDBcbiAgICAgID8gYXZhaWxhYmxlUG9vbGVkU2xvdHNcbiAgICAgIDogMFxuICAgIGpzb25Tb2NrZXQuYWNjZXB0c0lubGluZUpvYnMgPSBtZXNzYWdlLmFjY2VwdHNJbmxpbmUgIT09IGZhbHNlXG4gICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwiY2FuZGlkYXRlXCIpIHtcbiAgICAgIHRoaXMucmVhZHlXb3JrZXJzLmRlbGV0ZShqc29uU29ja2V0KVxuICAgICAgaWYgKCFqc29uU29ja2V0LmlzRHJhaW5pbmcpIHRoaXMuY2FuZGlkYXRlUmVhZHlXb3JrZXJzLmFkZChqc29uU29ja2V0KVxuICAgIH0gZWxzZSBpZiAodGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJhY3RpdmVcIiAmJiB0aGlzLl9hY3RpdmVPd25lcnNoaXBSZWFkeSAmJiBqc29uU29ja2V0LnN1cHBvcnRzSGFuZG9mZklkUmVwb3J0aW5nICYmICFqc29uU29ja2V0LmlzRHJhaW5pbmcpIHtcbiAgICAgIHRoaXMucmVhZHlXb3JrZXJzLmFkZChqc29uU29ja2V0KVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnJlYWR5V29ya2Vycy5kZWxldGUoanNvblNvY2tldClcbiAgICAgIHRoaXMuY2FuZGlkYXRlUmVhZHlXb3JrZXJzLmRlbGV0ZShqc29uU29ja2V0KVxuICAgIH1cbiAgICB0aGlzLm9uV29ya2VyUmVhZHk/Lihqc29uU29ja2V0KVxuICAgIHZvaWQgdGhpcy5fZHJhaW4oKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIHdvcmtlciBkcmFpbmluZy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9oYW5kbGVXb3JrZXJEcmFpbmluZyh7anNvblNvY2tldH0pIHtcbiAgICAvLyBUaGUgd29ya2VyIGlzIHNodXR0aW5nIGRvd24gZ3JhY2VmdWxseS4gU3RvcCBkaXNwYXRjaGluZyBuZXcgam9ic1xuICAgIC8vIHRvIGl0IGJ1dCBrZWVwIHRoZSBjb25uZWN0aW9uIGluIGB3b3JrZXJzYCBzbyBhbnkgaW4tZmxpZ2h0IGpvYlxuICAgIC8vIGl0J3Mgc3RpbGwgZHJhaW5pbmcgY2FuIHJlcG9ydCBpdHMgcmVzdWx0LlxuICAgIGpzb25Tb2NrZXQuaXNEcmFpbmluZyA9IHRydWVcbiAgICB0aGlzLnJlYWR5V29ya2Vycy5kZWxldGUoanNvblNvY2tldClcbiAgICB0aGlzLmNhbmRpZGF0ZVJlYWR5V29ya2Vycy5kZWxldGUoanNvblNvY2tldClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZW1vdmVzIGEgbG9zdCB3b3JrZXIgc29ja2V0IGFuZCByZWxlYXNlcyBvbmx5IGxlYXNlcyBkaXNwYXRjaGVkIHRocm91Z2ggaXQuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gd29ya2VyIC0gRGlzY29ubmVjdGVkIHdvcmtlciBzb2NrZXQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBDb29yZGluYXRpb24gb3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5xdWV1ZVJlZHJhaW5dIC0gUXVldWUgYW5vdGhlciBwYXNzIGluc3RlYWQgb2YgYXdhaXRpbmcgdGhlIGFjdGl2ZSBkcmFpbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgaXRzIGFjdGl2ZSBsZWFzZXMgYXJlIHJlbGVhc2VkLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZVdvcmtlclNvY2tldENsb3NlZCh3b3JrZXIsIHtxdWV1ZVJlZHJhaW4gPSBmYWxzZX0gPSB7fSkge1xuICAgIHRoaXMud29ya2Vycy5kZWxldGUod29ya2VyKVxuICAgIHRoaXMucmVhZHlXb3JrZXJzLmRlbGV0ZSh3b3JrZXIpXG4gICAgdGhpcy5jYW5kaWRhdGVSZWFkeVdvcmtlcnMuZGVsZXRlKHdvcmtlcilcblxuICAgIGlmICh0aGlzLl9zdG9wcGVkKSB7XG4gICAgICB0aGlzLndvcmtlckhhbmRvZmZzLmRlbGV0ZSh3b3JrZXIpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBoYW5kb2ZmcyA9IHRoaXMud29ya2VySGFuZG9mZnMuZ2V0KHdvcmtlcilcbiAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQgJiYgd29ya2VyLndvcmtlcklkICYmIGhhbmRvZmZzICYmIGhhbmRvZmZzLnNpemUgPiAwKSB7XG4gICAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuZGlzY29ubmVjdGVkV29ya2Vycy5nZXQod29ya2VyLndvcmtlcklkKVxuICAgICAgaWYgKGV4aXN0aW5nPy53b3JrZXIgPT09IHdvcmtlcikgcmV0dXJuXG4gICAgICBpZiAoZXhpc3RpbmcpIHRoaXMuY2xvY2suY2xlYXJUaW1lb3V0KGV4aXN0aW5nLnRpbWVyKVxuXG4gICAgICBjb25zdCB0aW1lciA9IHRoaXMuY2xvY2suc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIHRoaXMuZGlzY29ubmVjdGVkV29ya2Vycy5kZWxldGUod29ya2VyLndvcmtlcklkIHx8IFwiXCIpXG4gICAgICAgIHZvaWQgdGhpcy5fcmVsZWFzZVdvcmtlckhhbmRvZmZzKHdvcmtlcikudGhlbigoKSA9PiB7XG4gICAgICAgICAgaWYgKHdvcmtlci53b3JrZXJJZCkgdGhpcy5vbldvcmtlckhhbmRvZmZzUmVsZWFzZWQ/Lih3b3JrZXIud29ya2VySWQpXG4gICAgICAgIH0sIChlcnJvcikgPT4ge1xuICAgICAgICAgIHRoaXMuX3JlcG9ydEhhbmRvZmZSZWxlYXNlRXJyb3IoZXJyb3IpXG4gICAgICAgICAgdGhpcy5fc2NoZWR1bGVFcnJvclJldHJ5KClcbiAgICAgICAgfSlcbiAgICAgIH0sIHRoaXMud29ya2VyUmVjb25uZWN0R3JhY2VNcylcbiAgICAgIGlmICh0eXBlb2YgdGltZXIgPT09IFwib2JqZWN0XCIpIHRpbWVyLnVucmVmKClcbiAgICAgIHRoaXMuZGlzY29ubmVjdGVkV29ya2Vycy5zZXQod29ya2VyLndvcmtlcklkLCB7d29ya2VyLCB0aW1lcn0pXG4gICAgICB0aGlzLm9uV29ya2VyRGlzY29ubmVjdGVkPy4od29ya2VyLndvcmtlcklkKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VXb3JrZXJIYW5kb2Zmcyh3b3JrZXIsIHtxdWV1ZVJlZHJhaW59KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLl9yZXBvcnRIYW5kb2ZmUmVsZWFzZUVycm9yKGVycm9yKVxuICAgICAgdGhpcy5fc2NoZWR1bGVFcnJvclJldHJ5KClcbiAgICB9XG4gICAgdGhpcy5fbWF5YmVTdG9wUmV0aXJlZCgpXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgYWxsIGxlYXNlcyBzdGlsbCBvd25lZCBieSBvbmUgZXhhY3Qgd29ya2VyIHNvY2tldC5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSB3b3JrZXIgLSBXb3JrZXIgc29ja2V0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gQ29vcmRpbmF0aW9uIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MucXVldWVSZWRyYWluXSAtIFF1ZXVlIGFub3RoZXIgcGFzcyBpbnN0ZWFkIG9mIGF3YWl0aW5nIHRoZSBhY3RpdmUgZHJhaW4uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGZlbmNlZCByZWxlYXNlcyBhbmQgZGlzcGF0Y2ggd2FrZS11cC5cbiAgICovXG4gIGFzeW5jIF9yZWxlYXNlV29ya2VySGFuZG9mZnMod29ya2VyLCB7cXVldWVSZWRyYWluID0gZmFsc2V9ID0ge30pIHtcbiAgICBjb25zdCBoYW5kb2ZmcyA9IHRoaXMud29ya2VySGFuZG9mZnMuZ2V0KHdvcmtlcilcblxuICAgIGlmICghaGFuZG9mZnMgfHwgaGFuZG9mZnMuc2l6ZSA9PT0gMCkge1xuICAgICAgdGhpcy53b3JrZXJIYW5kb2Zmcy5kZWxldGUod29ya2VyKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBbam9iSWQsIGhhbmRvZmZJZF0gb2YgaGFuZG9mZnMpIHtcbiAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VIYW5kb2ZmKHtoYW5kb2ZmSWQsIGpvYklkLCB3b3JrZXJ9KVxuICAgIH1cblxuICAgIHRoaXMud29ya2VySGFuZG9mZnMuZGVsZXRlKHdvcmtlcilcbiAgICB0aGlzLl9ub3RpZnlFbnF1ZXVlZCgpXG4gICAgaWYgKHF1ZXVlUmVkcmFpbikge1xuICAgICAgdGhpcy5fcmVkcmFpblF1ZXVlZCA9IHRydWVcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwiYWN0aXZlXCIpIGF3YWl0IHRoaXMuX2RyYWluKClcbiAgICB9XG4gICAgdGhpcy5fbWF5YmVTdG9wUmV0aXJlZCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBvbmUgaWRlbXBvdGVudCBjb25kaXRpb25hbCBsZWFzZSByZWxlYXNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmhhbmRvZmZJZCAtIEhhbmRvZmYgbGVhc2UgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3Mud29ya2VyIC0gU29ja2V0IHRoYXQgcmVjZWl2ZWQgdGhlIGxlYXNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgZmVuY2VkIHRyYW5zaXRpb24uXG4gICAqL1xuICBhc3luYyBfcmVsZWFzZUhhbmRvZmYoe2hhbmRvZmZJZCwgam9iSWQsIHdvcmtlcn0pIHtcbiAgICBhd2FpdCB0aGlzLnN0b3JlLm1hcmtSZXR1cm5lZFRvUXVldWUoe2hhbmRvZmZJZCwgam9iSWR9KVxuXG4gICAgY29uc3QgaGFuZG9mZnMgPSB0aGlzLndvcmtlckhhbmRvZmZzLmdldCh3b3JrZXIpXG5cbiAgICBpZiAoaGFuZG9mZnM/LmdldChqb2JJZCkgPT09IGhhbmRvZmZJZCkgaGFuZG9mZnMuZGVsZXRlKGpvYklkKVxuICB9XG5cbiAgLyoqXG4gICAqIEZvcmdldHMgYSBzdWNjZXNzZnVsbHkgcmVwb3J0ZWQgbGVhc2Ugd2l0aG91dCByZWx5aW5nIG9uIHdvcmtlciBpZHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuaGFuZG9mZklkIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2ZvcmdldEhhbmRvZmYoe2hhbmRvZmZJZCwgam9iSWR9KSB7XG4gICAgZm9yIChjb25zdCBbd29ya2VyLCBoYW5kb2Zmc10gb2YgdGhpcy53b3JrZXJIYW5kb2Zmcykge1xuICAgICAgaWYgKGhhbmRvZmZzLmdldChqb2JJZCkgIT09IGhhbmRvZmZJZCkgY29udGludWVcblxuICAgICAgaGFuZG9mZnMuZGVsZXRlKGpvYklkKVxuICAgICAgaWYgKGhhbmRvZmZzLnNpemUgPT09IDAgJiYgIXRoaXMud29ya2Vycy5oYXMod29ya2VyKSkgdGhpcy53b3JrZXJIYW5kb2Zmcy5kZWxldGUod29ya2VyKVxuICAgICAgaWYgKGhhbmRvZmZzLnNpemUgPT09IDAgJiYgd29ya2VyLndvcmtlcklkKSB7XG4gICAgICAgIGNvbnN0IGRpc2Nvbm5lY3RlZCA9IHRoaXMuZGlzY29ubmVjdGVkV29ya2Vycy5nZXQod29ya2VyLndvcmtlcklkKVxuICAgICAgICBpZiAoZGlzY29ubmVjdGVkPy53b3JrZXIgPT09IHdvcmtlcikge1xuICAgICAgICAgIHRoaXMuY2xvY2suY2xlYXJUaW1lb3V0KGRpc2Nvbm5lY3RlZC50aW1lcilcbiAgICAgICAgICB0aGlzLmRpc2Nvbm5lY3RlZFdvcmtlcnMuZGVsZXRlKHdvcmtlci53b3JrZXJJZClcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgdGhpcy5fbWF5YmVTdG9wUmV0aXJlZCgpXG4gICAgICByZXR1cm5cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVwb3J0cyBhbiB1bmV4cGVjdGVkIGxlYXNlLXJlbGVhc2UgZmFpbHVyZSBvbiBmcmFtZXdvcmsgZXJyb3IgY2hhbm5lbHMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gUmVsZWFzZSBmYWlsdXJlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXBvcnRIYW5kb2ZmUmVsZWFzZUVycm9yKGVycm9yKSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG4gICAgY29uc3QgcGF5bG9hZCA9IHtjb250ZXh0OiB7c3RhZ2U6IFwiYmFja2dyb3VuZC1qb2ItaGFuZG9mZi1yZWxlYXNlXCJ9LCBlcnJvcjogbm9ybWFsaXplZEVycm9yfVxuICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIkZhaWxlZCB0byByZWxlYXNlIGRpc2Nvbm5lY3RlZCB3b3JrZXIgaGFuZG9mZnM6XCIsIG5vcm1hbGl6ZWRFcnJvcl0pXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gIH1cblxuICAvKipcbiAgICogUmVwb3J0cyBhbiB1bmV4cGVjdGVkIHdvcmtlci1oYW5kb2ZmIGFkb3B0aW9uIGZhaWx1cmUgb24gZnJhbWV3b3JrIGVycm9yXG4gICAqIGNoYW5uZWxzLiBBIGZhaWxlZCBhZG9wdGlvbiBpcyBub3QgZmF0YWwgKHRoZSB3b3JrZXIncyBqb2JzIHJlbWFpbiBhbmQgYXJlXG4gICAqIHJlY2xhaW1lZCBieSB0aGUgb3JwaGFuIHN3ZWVwKSwgYnV0IG11c3Qgc3VyZmFjZSByYXRoZXIgdGhhbiBiZSBzd2FsbG93ZWQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gQWRvcHRpb24gZmFpbHVyZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVwb3J0SGFuZG9mZkFkb3B0RXJyb3IoZXJyb3IpIHtcbiAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICBjb25zdCBwYXlsb2FkID0ge2NvbnRleHQ6IHtzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi1oYW5kb2ZmLWFkb3B0XCJ9LCBlcnJvcjogbm9ybWFsaXplZEVycm9yfVxuICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIkZhaWxlZCB0byBhZG9wdCByZWNvbm5lY3RlZCB3b3JrZXIgaGFuZG9mZnM6XCIsIG5vcm1hbGl6ZWRFcnJvcl0pXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gIH1cblxuICAvKipcbiAgICogUmVwb3J0cyBhbiB1bmV4cGVjdGVkIHN0YXJ0dXAtc25hcHNob3QgcmVjbGFpbSBmYWlsdXJlIHdoaWxlIHJldGFpbmluZyB0aGVcbiAgICogc25hcHNob3QgZm9yIHRoZSBkaXNwYXRjaGVyJ3MgZXhpc3RpbmcgdHJhbnNpZW50LWVycm9yIHJldHJ5IGxpZmVjeWNsZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBSZWNsYWltIGZhaWx1cmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlcG9ydFN0YXJ0dXBIYW5kb2ZmUmVjbGFpbUVycm9yKGVycm9yKSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG4gICAgY29uc3QgcGF5bG9hZCA9IHtjb250ZXh0OiB7c3RhZ2U6IFwiYmFja2dyb3VuZC1qb2Itc3RhcnR1cC1oYW5kb2ZmLXJlY2xhaW1cIn0sIGVycm9yOiBub3JtYWxpemVkRXJyb3J9XG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiRmFpbGVkIHRvIHJlY2xhaW0gZGlzY29ubmVjdGVkIHN0YXJ0dXAgaGFuZG9mZnM6XCIsIG5vcm1hbGl6ZWRFcnJvcl0pXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgZW5xdWV1ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkVucXVldWVNZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBNZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGhhbmRsZWQuXG4gICAqL1xuICBhc3luYyBfaGFuZGxlRW5xdWV1ZSh7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICB0cnkge1xuICAgICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkXG4gICAgICAgICYmIHR5cGVvZiBtZXNzYWdlLnByb2R1Y2VyUHJvb2Y/LndvcmtlcklkID09PSBcInN0cmluZ1wiXG4gICAgICAgICYmICF3b3JrZXJJZEJlbG9uZ3NUb0dlbmVyYXRpb24oe2dlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWQsIHdvcmtlcklkOiBtZXNzYWdlLnByb2R1Y2VyUHJvb2Yud29ya2VySWR9KSkge1xuICAgICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKFwiQmFja2dyb3VuZCBqb2IgcHJvZHVjZXIgaGFuZG9mZiBiZWxvbmdzIHRvIGFub3RoZXIgZ2VuZXJhdGlvbi5cIiwge1xuICAgICAgICAgIGNvZGU6IFwiYmFja2dyb3VuZC1qb2ItcHJvZHVjZXItZ2VuZXJhdGlvbi1taXNtYXRjaFwiXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJlcXVlc3QgPSB7XG4gICAgICAgIGpvYk5hbWU6IG1lc3NhZ2Uuam9iTmFtZSxcbiAgICAgICAgYXJnczogbWVzc2FnZS5hcmdzIHx8IFtdLFxuICAgICAgICBvcHRpb25zOiBtZXNzYWdlLm9wdGlvbnMgfHwge31cbiAgICAgIH1cbiAgICAgIGNvbnN0IGpvYklkID0gdGhpcy5nZW5lcmF0aW9uSWQgJiYgbWVzc2FnZS5wcm9kdWNlclByb29mXG4gICAgICAgID8gYXdhaXQgdGhpcy5zdG9yZS5lbnF1ZXVlRnJvbU93bmVkSGFuZG9mZih7Li4ucmVxdWVzdCwgcHJvZHVjZXJJbnZvY2F0aW9uSWQ6IG1lc3NhZ2UucHJvZHVjZXJJbnZvY2F0aW9uSWQsIHByb2R1Y2VyUHJvb2Y6IG1lc3NhZ2UucHJvZHVjZXJQcm9vZn0pXG4gICAgICAgIDogYXdhaXQgdGhpcy5zdG9yZS5lbnF1ZXVlKHJlcXVlc3QpXG5cbiAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJlbnF1ZXVlZFwiLCBqb2JJZH0pXG4gICAgICB0aGlzLl9ub3RpZnlFbnF1ZXVlZCgpXG4gICAgICBpZiAodGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJhY3RpdmVcIikgYXdhaXQgdGhpcy5fZHJhaW4oKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLl9oYW5kbGVDbGllbnRNdXRhdGlvbkVycm9yKHtcbiAgICAgICAgY29udGV4dDoge2pvYk5hbWU6IG1lc3NhZ2Uuam9iTmFtZSwgc3RhZ2U6IFwiYmFja2dyb3VuZC1qb2ItZW5xdWV1ZVwifSxcbiAgICAgICAgZXJyb3IsXG4gICAgICAgIGZhbGxiYWNrTWVzc2FnZTogXCJGYWlsZWQgdG8gZW5xdWV1ZSBqb2JcIixcbiAgICAgICAganNvblNvY2tldCxcbiAgICAgICAgbG9nTWVzc2FnZTogXCJGYWlsZWQgdG8gZW5xdWV1ZSBiYWNrZ3JvdW5kIGpvYjpcIixcbiAgICAgICAgcmVzcG9uc2VUeXBlOiBcImVucXVldWUtZXJyb3JcIlxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSGFuZGxlcyBhIHN0YWJsZS1rZXkgcmVwbGFjZW1lbnQgcmVxdWVzdCBhbmQgcmUtYXJtcyBkaXNwYXRjaCBhZnRlcndhcmQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLmpzb25Tb2NrZXQgLSBKU09OIHNvY2tldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSZXBsYWNlU2NoZWR1bGVkTWVzc2FnZX0gYXJncy5tZXNzYWdlIC0gTWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBoYW5kbGVkLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZVJlcGxhY2VTY2hlZHVsZWQoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuc3RvcmUucmVwbGFjZVNjaGVkdWxlZCh7XG4gICAgICAgIHNjaGVkdWxlS2V5OiBtZXNzYWdlLnNjaGVkdWxlS2V5LFxuICAgICAgICBqb2JOYW1lOiBtZXNzYWdlLmpvYk5hbWUsXG4gICAgICAgIGFyZ3M6IG1lc3NhZ2UuYXJncyB8fCBbXSxcbiAgICAgICAgb3B0aW9uczogbWVzc2FnZS5vcHRpb25zIHx8IHt9XG4gICAgICB9KVxuXG4gICAgICB0aGlzLl9ub3RpZnlFbnF1ZXVlZCgpXG4gICAgICBhd2FpdCB0aGlzLl9kcmFpbigpXG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwic2NoZWR1bGUtcmVwbGFjZWRcIiwgLi4ucmVzdWx0fSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5faGFuZGxlQ2xpZW50TXV0YXRpb25FcnJvcih7XG4gICAgICAgIGNvbnRleHQ6IHtqb2JOYW1lOiBtZXNzYWdlLmpvYk5hbWUsIHNjaGVkdWxlS2V5OiBtZXNzYWdlLnNjaGVkdWxlS2V5LCBzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi1yZXBsYWNlLXNjaGVkdWxlZFwifSxcbiAgICAgICAgZXJyb3IsXG4gICAgICAgIGZhbGxiYWNrTWVzc2FnZTogXCJGYWlsZWQgdG8gcmVwbGFjZSBzY2hlZHVsZWQgam9iXCIsXG4gICAgICAgIGpzb25Tb2NrZXQsXG4gICAgICAgIGxvZ01lc3NhZ2U6IFwiRmFpbGVkIHRvIHJlcGxhY2Ugc2NoZWR1bGVkIGJhY2tncm91bmQgam9iOlwiLFxuICAgICAgICByZXNwb25zZVR5cGU6IFwicmVwbGFjZS1zY2hlZHVsZWQtZXJyb3JcIlxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSGFuZGxlcyBhIHN0YWJsZS1rZXkgY2FuY2VsbGF0aW9uIHJlcXVlc3QgYW5kIHJlLWFybXMgZGlzcGF0Y2ggYWZ0ZXJ3YXJkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy5qc29uU29ja2V0IC0gSlNPTiBzb2NrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iQ2FuY2VsU2NoZWR1bGVkTWVzc2FnZX0gYXJncy5tZXNzYWdlIC0gTWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBoYW5kbGVkLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZUNhbmNlbFNjaGVkdWxlZCh7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5zdG9yZS5jYW5jZWxTY2hlZHVsZWQobWVzc2FnZS5zY2hlZHVsZUtleSlcblxuICAgICAgdGhpcy5fbm90aWZ5RW5xdWV1ZWQoKVxuICAgICAgYXdhaXQgdGhpcy5fZHJhaW4oKVxuICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcInNjaGVkdWxlLWNhbmNlbGxlZFwiLCAuLi5yZXN1bHR9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLl9oYW5kbGVDbGllbnRNdXRhdGlvbkVycm9yKHtcbiAgICAgICAgY29udGV4dDoge3NjaGVkdWxlS2V5OiBtZXNzYWdlLnNjaGVkdWxlS2V5LCBzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi1jYW5jZWwtc2NoZWR1bGVkXCJ9LFxuICAgICAgICBlcnJvcixcbiAgICAgICAgZmFsbGJhY2tNZXNzYWdlOiBcIkZhaWxlZCB0byBjYW5jZWwgc2NoZWR1bGVkIGpvYlwiLFxuICAgICAgICBqc29uU29ja2V0LFxuICAgICAgICBsb2dNZXNzYWdlOiBcIkZhaWxlZCB0byBjYW5jZWwgc2NoZWR1bGVkIGJhY2tncm91bmQgam9iOlwiLFxuICAgICAgICByZXNwb25zZVR5cGU6IFwiY2FuY2VsLXNjaGVkdWxlZC1lcnJvclwiXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGVzIGEgc3RhYmxlIHNjaGVkdWxlIGxvb2t1cCBhbmQgcmV0dXJucyBvbmx5IG5vcm1hbGl6ZWQgYWRhcHRlciBqb2JzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy5qc29uU29ja2V0IC0gSlNPTiBzb2NrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iR2V0U2NoZWR1bGVkTWVzc2FnZX0gYXJncy5tZXNzYWdlIC0gTWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBoYW5kbGVkLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZUdldFNjaGVkdWxlZEpvYih7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5zdG9yZS5nZXRTY2hlZHVsZWRKb2IobWVzc2FnZS5zY2hlZHVsZUtleSwge1xuICAgICAgICBpbmNsdWRlTGF0ZXN0VGVybWluYWw6IG1lc3NhZ2UuaW5jbHVkZUxhdGVzdFRlcm1pbmFsXG4gICAgICB9KVxuXG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwic2NoZWR1bGVkLWpvYlwiLCAuLi5yZXN1bHR9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLl9oYW5kbGVDbGllbnRNdXRhdGlvbkVycm9yKHtcbiAgICAgICAgY29udGV4dDoge3NjaGVkdWxlS2V5OiBtZXNzYWdlLnNjaGVkdWxlS2V5LCBzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi1nZXQtc2NoZWR1bGVkXCJ9LFxuICAgICAgICBlcnJvcixcbiAgICAgICAgZmFsbGJhY2tNZXNzYWdlOiBcIkZhaWxlZCB0byByZWFkIHNjaGVkdWxlZCBqb2JcIixcbiAgICAgICAganNvblNvY2tldCxcbiAgICAgICAgbG9nTWVzc2FnZTogXCJGYWlsZWQgdG8gcmVhZCBzY2hlZHVsZWQgYmFja2dyb3VuZCBqb2I6XCIsXG4gICAgICAgIHJlc3BvbnNlVHlwZTogXCJnZXQtc2NoZWR1bGVkLWpvYi1lcnJvclwiXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGVzIGEgc3RhYmxlIHNjaGVkdWxlIHdha2UgYW5kIHJlLWFybXMgZGlzcGF0Y2ggYWZ0ZXIgaXRzIHRyYW5zYWN0aW9uIGNvbW1pdHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLmpzb25Tb2NrZXQgLSBKU09OIHNvY2tldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JXYWtlU2NoZWR1bGVkTWVzc2FnZX0gYXJncy5tZXNzYWdlIC0gTWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBoYW5kbGVkLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZVdha2VTY2hlZHVsZWQoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuc3RvcmUud2FrZVNjaGVkdWxlZChtZXNzYWdlLnNjaGVkdWxlS2V5KVxuXG4gICAgICBpZiAocmVzdWx0Lm91dGNvbWUgPT09IFwid29rZW5cIiB8fCByZXN1bHQub3V0Y29tZSA9PT0gXCJhbHJlYWR5X2R1ZVwiKSB7XG4gICAgICAgIHRoaXMuX25vdGlmeUVucXVldWVkKClcbiAgICAgICAgYXdhaXQgdGhpcy5fZHJhaW4oKVxuICAgICAgfVxuXG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwic2NoZWR1bGUtd29rZW5cIiwgLi4ucmVzdWx0fSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5faGFuZGxlQ2xpZW50TXV0YXRpb25FcnJvcih7XG4gICAgICAgIGNvbnRleHQ6IHtzY2hlZHVsZUtleTogbWVzc2FnZS5zY2hlZHVsZUtleSwgc3RhZ2U6IFwiYmFja2dyb3VuZC1qb2Itd2FrZS1zY2hlZHVsZWRcIn0sXG4gICAgICAgIGVycm9yLFxuICAgICAgICBmYWxsYmFja01lc3NhZ2U6IFwiRmFpbGVkIHRvIHdha2Ugc2NoZWR1bGVkIGpvYlwiLFxuICAgICAgICBqc29uU29ja2V0LFxuICAgICAgICBsb2dNZXNzYWdlOiBcIkZhaWxlZCB0byB3YWtlIHNjaGVkdWxlZCBiYWNrZ3JvdW5kIGpvYjpcIixcbiAgICAgICAgcmVzcG9uc2VUeXBlOiBcIndha2Utc2NoZWR1bGVkLWVycm9yXCJcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgc2FmZSB2YWxpZGF0aW9uIGZhaWx1cmVzIGFuZCByZXBvcnRzIHVuZXhwZWN0ZWQgY2xpZW50IG11dGF0aW9ucy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5jb250ZXh0IC0gRnJhbWV3b3JrLWVycm9yIGNvbnRleHQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuZXJyb3IgLSBNdXRhdGlvbiBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5mYWxsYmFja01lc3NhZ2UgLSBDbGllbnQtc2FmZSBmYWxsYmFjayBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5sb2dNZXNzYWdlIC0gRXJyb3IgbG9nIHByZWZpeC5cbiAgICogQHBhcmFtIHtcImVucXVldWUtZXJyb3JcIiB8IFwicmVwbGFjZS1zY2hlZHVsZWQtZXJyb3JcIiB8IFwiY2FuY2VsLXNjaGVkdWxlZC1lcnJvclwiIHwgXCJnZXQtc2NoZWR1bGVkLWpvYi1lcnJvclwiIHwgXCJ3YWtlLXNjaGVkdWxlZC1lcnJvclwifSBhcmdzLnJlc3BvbnNlVHlwZSAtIFJlc3BvbnNlIHR5cGUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2hhbmRsZUNsaWVudE11dGF0aW9uRXJyb3Ioe2NvbnRleHQsIGVycm9yLCBmYWxsYmFja01lc3NhZ2UsIGpzb25Tb2NrZXQsIGxvZ01lc3NhZ2UsIHJlc3BvbnNlVHlwZX0pIHtcbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBWZWxvY2lvdXNFcnJvciAmJiBlcnJvci5zYWZlVG9FeHBvc2UpIHtcbiAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogcmVzcG9uc2VUeXBlLCBlcnJvcjogZXJyb3IubWVzc2FnZX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICBjb25zdCBwYXlsb2FkID0ge2NvbnRleHQsIGVycm9yOiBub3JtYWxpemVkRXJyb3J9XG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW2xvZ01lc3NhZ2UsIG5vcm1hbGl6ZWRFcnJvcl0pXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gICAganNvblNvY2tldC5zZW5kKHt0eXBlOiByZXNwb25zZVR5cGUsIGVycm9yOiBmYWxsYmFja01lc3NhZ2V9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIGpvYiBjb21wbGV0ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkNvbXBsZXRlTWVzc2FnZX0gYXJncy5tZXNzYWdlIC0gTWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBoYW5kbGVkLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZUpvYkNvbXBsZXRlKHtqc29uU29ja2V0LCBtZXNzYWdlfSkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBhY2NlcHRlZCA9IGF3YWl0IHRoaXMuc3RvcmUubWFya0NvbXBsZXRlZCh7XG4gICAgICAgIGpvYklkOiBtZXNzYWdlLmpvYklkLFxuICAgICAgICBoYW5kb2ZmSWQ6IG1lc3NhZ2UuaGFuZG9mZklkLFxuICAgICAgICB3b3JrZXJJZDogbWVzc2FnZS53b3JrZXJJZCxcbiAgICAgICAgaGFuZGVkT2ZmQXRNczogbWVzc2FnZS5oYW5kZWRPZmZBdE1zXG4gICAgICB9KVxuICAgICAgaWYgKGFjY2VwdGVkICYmIG1lc3NhZ2UuaGFuZG9mZklkKSB7XG4gICAgICAgIHRoaXMuX2ZvcmdldEhhbmRvZmYoe2hhbmRvZmZJZDogbWVzc2FnZS5oYW5kb2ZmSWQsIGpvYklkOiBtZXNzYWdlLmpvYklkfSlcbiAgICAgIH1cbiAgICAgIHRoaXMub25Kb2JVcGRhdGVkPy4oe2FjY2VwdGVkLCBqb2JJZDogbWVzc2FnZS5qb2JJZCwgc3RhdHVzOiBcImNvbXBsZXRlZFwifSlcbiAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJqb2ItdXBkYXRlZFwiLCBqb2JJZDogbWVzc2FnZS5qb2JJZH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuX3JlcG9ydEpvYlVwZGF0ZUZhaWx1cmUoe2Vycm9yLCBqb2JJZDogbWVzc2FnZS5qb2JJZCwgc3RhZ2U6IFwiYmFja2dyb3VuZC1qb2ItY29tcGxldGVcIn0pXG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiam9iLXVwZGF0ZS1lcnJvclwiLCBqb2JJZDogbWVzc2FnZS5qb2JJZCwgZXJyb3I6IFwiRmFpbGVkIHRvIHVwZGF0ZSBqb2JcIn0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFN1cmZhY2VzIGFuIHVuZXhwZWN0ZWQgZHVyYWJsZSByZXBvcnQgZmFpbHVyZSB3aXRob3V0IGV4cG9zaW5nIGl0IHRvIHRoZVxuICAgKiByZXBvcnRpbmcgcGVlci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBGYWlsdXJlIGNvbnRleHQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuZXJyb3IgLSBBZGFwdGVyIGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gRHVyYWJsZSBqb2IgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnN0YWdlIC0gTXV0YXRpb24gc3RhZ2UuXG4gICAqL1xuICBfcmVwb3J0Sm9iVXBkYXRlRmFpbHVyZSh7ZXJyb3IsIGpvYklkLCBzdGFnZX0pIHtcbiAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICBjb25zdCBwYXlsb2FkID0ge2NvbnRleHQ6IHtnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkLCBqb2JJZCwgc3RhZ2V9LCBlcnJvcjogbm9ybWFsaXplZEVycm9yfVxuICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIkZhaWxlZCB0byB1cGRhdGUgYmFja2dyb3VuZCBqb2I6XCIsIG5vcm1hbGl6ZWRFcnJvcl0pXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gIH1cblxuICAvKipcbiAgICogUGVyc2lzdHMgYSBub3JtYWwgam9iIHJlc2NoZWR1bGUgb3V0Y29tZSBhbmQgd2FrZXMgc2NoZWR1bGVkIGRpc3BhdGNoLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy5qc29uU29ja2V0IC0gSlNPTiBzb2NrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUmVzY2hlZHVsZU1lc3NhZ2V9IGFyZ3MubWVzc2FnZSAtIE1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gaGFuZGxlZC5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVKb2JSZXNjaGVkdWxlKHtqc29uU29ja2V0LCBtZXNzYWdlfSkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBhY2NlcHRlZCA9IGF3YWl0IHRoaXMuc3RvcmUubWFya1Jlc2NoZWR1bGVkKHtcbiAgICAgICAgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsXG4gICAgICAgIGRlbGF5TXM6IG1lc3NhZ2UuZGVsYXlNcyxcbiAgICAgICAgaGFuZG9mZklkOiBtZXNzYWdlLmhhbmRvZmZJZCxcbiAgICAgICAgd29ya2VySWQ6IG1lc3NhZ2Uud29ya2VySWQsXG4gICAgICAgIGhhbmRlZE9mZkF0TXM6IG1lc3NhZ2UuaGFuZGVkT2ZmQXRNc1xuICAgICAgfSlcbiAgICAgIGlmIChhY2NlcHRlZCAmJiBtZXNzYWdlLmhhbmRvZmZJZCkge1xuICAgICAgICB0aGlzLl9mb3JnZXRIYW5kb2ZmKHtoYW5kb2ZmSWQ6IG1lc3NhZ2UuaGFuZG9mZklkLCBqb2JJZDogbWVzc2FnZS5qb2JJZH0pXG4gICAgICB9XG4gICAgICB0aGlzLm9uSm9iVXBkYXRlZD8uKHthY2NlcHRlZCwgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsIHN0YXR1czogXCJyZXNjaGVkdWxlZFwifSlcbiAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJqb2ItdXBkYXRlZFwiLCBqb2JJZDogbWVzc2FnZS5qb2JJZH0pXG4gICAgICB0aGlzLl9ub3RpZnlFbnF1ZXVlZCgpXG4gICAgICBhd2FpdCB0aGlzLl9kcmFpbigpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKVxuICAgICAgY29uc3QgcGF5bG9hZCA9IHtjb250ZXh0OiB7am9iSWQ6IG1lc3NhZ2Uuam9iSWQsIHN0YWdlOiBcImJhY2tncm91bmQtam9iLXJlc2NoZWR1bGVcIn0sIGVycm9yOiBub3JtYWxpemVkRXJyb3J9XG4gICAgICBjb25zdCBlcnJvckV2ZW50cyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpXG5cbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIkZhaWxlZCB0byB1cGRhdGUgam9iIHJlc2NoZWR1bGU6XCIsIG5vcm1hbGl6ZWRFcnJvcl0pXG4gICAgICBlcnJvckV2ZW50cy5lbWl0KFwiZnJhbWV3b3JrLWVycm9yXCIsIHBheWxvYWQpXG4gICAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImpvYi11cGRhdGUtZXJyb3JcIiwgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsIGVycm9yOiBcIkZhaWxlZCB0byB1cGRhdGUgam9iXCJ9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBqb2IgZmFpbGVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy5qc29uU29ja2V0IC0gSlNPTiBzb2NrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRmFpbGVkTWVzc2FnZX0gYXJncy5tZXNzYWdlIC0gTWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBoYW5kbGVkLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZUpvYkZhaWxlZCh7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgZmFpbGVkSm9iID0gYXdhaXQgdGhpcy5zdG9yZS5tYXJrRmFpbGVkKHtcbiAgICAgICAgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsXG4gICAgICAgIGVycm9yOiBtZXNzYWdlLmVycm9yLFxuICAgICAgICBoYW5kb2ZmSWQ6IG1lc3NhZ2UuaGFuZG9mZklkLFxuICAgICAgICB3b3JrZXJJZDogbWVzc2FnZS53b3JrZXJJZCxcbiAgICAgICAgaGFuZGVkT2ZmQXRNczogbWVzc2FnZS5oYW5kZWRPZmZBdE1zXG4gICAgICB9KVxuXG4gICAgICBpZiAoZmFpbGVkSm9iKSB7XG4gICAgICAgIGlmIChtZXNzYWdlLmhhbmRvZmZJZCkge1xuICAgICAgICAgIHRoaXMuX2ZvcmdldEhhbmRvZmYoe2hhbmRvZmZJZDogbWVzc2FnZS5oYW5kb2ZmSWQsIGpvYklkOiBtZXNzYWdlLmpvYklkfSlcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9lbWl0QmFja2dyb3VuZEpvYkZhaWxlZCh7XG4gICAgICAgICAgZXJyb3I6IG1lc3NhZ2UuZXJyb3IsXG4gICAgICAgICAgaGFuZG9mZklkOiBtZXNzYWdlLmhhbmRvZmZJZCxcbiAgICAgICAgICBoYW5kZWRPZmZBdE1zOiBtZXNzYWdlLmhhbmRlZE9mZkF0TXMsXG4gICAgICAgICAgam9iOiBmYWlsZWRKb2IsXG4gICAgICAgICAgcnVubmVyRmFpbHVyZTogbWVzc2FnZS5ydW5uZXJGYWlsdXJlLFxuICAgICAgICAgIHdvcmtlcklkOiBtZXNzYWdlLndvcmtlcklkXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIHRoaXMub25Kb2JVcGRhdGVkPy4oe2FjY2VwdGVkOiBCb29sZWFuKGZhaWxlZEpvYiksIGpvYklkOiBtZXNzYWdlLmpvYklkLCBzdGF0dXM6IFwiZmFpbGVkXCJ9KVxuICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImpvYi11cGRhdGVkXCIsIGpvYklkOiBtZXNzYWdlLmpvYklkfSlcbiAgICAgIC8vIEEgZmFpbGVkIGpvYiBtYXkgaGF2ZSBiZWVuIHJlLXF1ZXVlZCAod2l0aCBiYWNrb2ZmKSBmb3IgcmV0cnkg4oCUXG4gICAgICAvLyBwb2tlIHRoZSBkaXNwYXRjaGVyIHNvIHRoZSByZXRyeSB0aW1lciBpcyBhcm1lZC5cbiAgICAgIHRoaXMuX25vdGlmeUVucXVldWVkKClcbiAgICAgIGF3YWl0IHRoaXMuX2RyYWluKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiRmFpbGVkIHRvIHVwZGF0ZSBqb2IgZmFpbHVyZTpcIiwgZXJyb3JdKVxuICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImpvYi11cGRhdGUtZXJyb3JcIiwgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsIGVycm9yOiBcIkZhaWxlZCB0byB1cGRhdGUgam9iXCJ9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVtaXQgYmFja2dyb3VuZCBqb2IgZmFpbGVkLlxuICAgKiBAcGFyYW0ge3tlcnJvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGhhbmRvZmZJZD86IHN0cmluZywgaGFuZGVkT2ZmQXRNcz86IG51bWJlciwgam9iOiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3csIHJ1bm5lckZhaWx1cmU/OiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZFJ1bm5lckZhaWx1cmUsIHdvcmtlcklkPzogc3RyaW5nfX0gYXJncyAtIEZhaWx1cmUgZXZlbnQgZGF0YS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfZW1pdEJhY2tncm91bmRKb2JGYWlsZWQoe2Vycm9yLCBoYW5kb2ZmSWQsIGhhbmRlZE9mZkF0TXMsIGpvYiwgcnVubmVyRmFpbHVyZSwgd29ya2VySWR9KSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gdGhpcy5fbm9ybWFsaXplRmFpbHVyZUVycm9yKGVycm9yKVxuICAgIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgICBjb250ZXh0OiB7XG4gICAgICAgIGF0dGVtcHRzOiBqb2IuYXR0ZW1wdHMsXG4gICAgICAgIGhhbmRvZmZJZCxcbiAgICAgICAgaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgam9iQXJnczogam9iLmFyZ3MsXG4gICAgICAgIGpvYklkOiBqb2IuaWQsXG4gICAgICAgIGpvYk5hbWU6IGpvYi5qb2JOYW1lLFxuICAgICAgICBtYXhSZXRyaWVzOiBqb2IubWF4UmV0cmllcyxcbiAgICAgICAgcnVubmVyRmFpbHVyZSxcbiAgICAgICAgc3RhZ2U6IFwiYmFja2dyb3VuZC1qb2ItZmFpbGVkXCIsXG4gICAgICAgIHN0YXR1czogam9iLnN0YXR1cyxcbiAgICAgICAgdGVybWluYWw6IGpvYi5zdGF0dXMgPT09IFwiZmFpbGVkXCIgfHwgam9iLnN0YXR1cyA9PT0gXCJvcnBoYW5lZFwiLFxuICAgICAgICB3aWxsUmV0cnk6IGpvYi5zdGF0dXMgPT09IFwicXVldWVkXCIsXG4gICAgICAgIHdvcmtlcklkXG4gICAgICB9LFxuICAgICAgZXJyb3I6IG5vcm1hbGl6ZWRFcnJvclxuICAgIH1cbiAgICBjb25zdCBlcnJvckV2ZW50cyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpXG5cbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYmFja2dyb3VuZC1qb2ItZmFpbGVkXCIsIHBheWxvYWQpXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4ucGF5bG9hZCwgZXJyb3JUeXBlOiBcImJhY2tncm91bmQtam9iLWZhaWxlZFwifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBFbWl0cyBgYmFja2dyb3VuZC1qb2Itb3JwaGFuZWRgIChtaXJyb3JlZCB0byBgYWxsLWVycm9yYCkgZm9yIGEgam9iIHRoZSB0aW1lLWJhc2VkIG9ycGhhbiBzd2VlcFxuICAgKiByZWNsYWltZWQgYWZ0ZXIgaXRzIHdvcmtlciBkaWVkIG1pZC1ydW4uIFVubGlrZSBgYmFja2dyb3VuZC1qb2ItZmFpbGVkYCwgd2hpY2ggZmlyZXMgb24gYVxuICAgKiB3b3JrZXIncyBmYWlsdXJlIHJlcG9ydCwgdGhpcyBmaXJlcyBmcm9tIHRoZSBtYWluIHByb2Nlc3MncyBzd2VlcCwgc28gYXBwbGljYXRpb25zIGNhbiByZWFjdCB0b1xuICAgKiBhIGRlYWQgd29ya2VyJ3Mgc3BlY2lmaWMgam9iIOKAlCByZWNvdmVyIHRoZSB3b3JrIGl0IGxlZnQgYmVoaW5kIOKAlCB3aXRob3V0IHBvbGxpbmcuIGB3aWxsUmV0cnlgXG4gICAqIHJlZmxlY3RzIHdoZXRoZXIgdGhlIHJlY2xhaW0gcmV0dXJuZWQgdGhlIGpvYiB0byB0aGUgcXVldWUgZm9yIGFub3RoZXIgYXR0ZW1wdC5cbiAgICogQHBhcmFtIHt7am9iOiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9fSBhcmdzIC0gVGhlIG9ycGhhbmVkIGpvYi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfZW1pdEJhY2tncm91bmRKb2JPcnBoYW5lZCh7am9ifSkge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IHRoaXMuX25vcm1hbGl6ZUZhaWx1cmVFcnJvcihqb2IubGFzdEVycm9yID8/IFwiSm9iIG9ycGhhbmVkIGFmdGVyIHRpbWVvdXRcIilcbiAgICBjb25zdCBwYXlsb2FkID0ge1xuICAgICAgY29udGV4dDoge1xuICAgICAgICBhdHRlbXB0czogam9iLmF0dGVtcHRzLFxuICAgICAgICBjaGlsZEluc3RhbmNlSWQ6IGpvYi5jaGlsZEluc3RhbmNlSWQsXG4gICAgICAgIGNoaWxkUGlkOiBqb2IuY2hpbGRQaWQsXG4gICAgICAgIGpvYkFyZ3M6IGpvYi5hcmdzLFxuICAgICAgICBqb2JJZDogam9iLmlkLFxuICAgICAgICBqb2JOYW1lOiBqb2Iuam9iTmFtZSxcbiAgICAgICAgbWF4UmV0cmllczogam9iLm1heFJldHJpZXMsXG4gICAgICAgIHJ1bm5lckhvc3RuYW1lOiBqb2IucnVubmVySG9zdG5hbWUsXG4gICAgICAgIHN0YWdlOiBcImJhY2tncm91bmQtam9iLW9ycGhhbmVkXCIsXG4gICAgICAgIHN0YXR1czogam9iLnN0YXR1cyxcbiAgICAgICAgdGVybWluYWw6IGpvYi5zdGF0dXMgPT09IFwiZmFpbGVkXCIgfHwgam9iLnN0YXR1cyA9PT0gXCJvcnBoYW5lZFwiLFxuICAgICAgICB3aWxsUmV0cnk6IGpvYi5zdGF0dXMgPT09IFwicXVldWVkXCIsXG4gICAgICAgIHdvcmtlcklkOiBqb2Iud29ya2VySWRcbiAgICAgIH0sXG4gICAgICBlcnJvcjogbm9ybWFsaXplZEVycm9yXG4gICAgfVxuICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJiYWNrZ3JvdW5kLWpvYi1vcnBoYW5lZFwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJiYWNrZ3JvdW5kLWpvYi1vcnBoYW5lZFwifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBmYWlsdXJlIGVycm9yLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBlcnJvciAtIFJlcG9ydGVkIGZhaWx1cmUgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtFcnJvcn0gTm9ybWFsaXplZCBlcnJvci5cbiAgICovXG4gIF9ub3JtYWxpemVGYWlsdXJlRXJyb3IoZXJyb3IpIHtcbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikgcmV0dXJuIGVycm9yXG5cbiAgICByZXR1cm4gdGhpcy5fZXJyb3JGcm9tVW5rbm93bkZhaWx1cmUoZXJyb3IpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlcnJvciBmcm9tIHVua25vd24gZmFpbHVyZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBSZXBvcnRlZCBmYWlsdXJlIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7RXJyb3J9IE5vcm1hbGl6ZWQgZXJyb3IuXG4gICAqL1xuICBfZXJyb3JGcm9tVW5rbm93bkZhaWx1cmUoZXJyb3IpIHtcbiAgICBjb25zdCBtZXNzYWdlID0gdGhpcy5fbWVzc2FnZUZyb21Vbmtub3duRmFpbHVyZShlcnJvcilcbiAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBuZXcgRXJyb3IobWVzc2FnZSlcblxuICAgIHRoaXMuX2NvcHlTdHJpbmdGYWlsdXJlU3RhY2soe2Vycm9yLCBub3JtYWxpemVkRXJyb3J9KVxuXG4gICAgcmV0dXJuIG5vcm1hbGl6ZWRFcnJvclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWVzc2FnZSBmcm9tIHVua25vd24gZmFpbHVyZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBSZXBvcnRlZCBmYWlsdXJlIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBFcnJvciBtZXNzYWdlLlxuICAgKi9cbiAgX21lc3NhZ2VGcm9tVW5rbm93bkZhaWx1cmUoZXJyb3IpIHtcbiAgICBpZiAodGhpcy5faGFzU3RyaW5nRmFpbHVyZShlcnJvcikpIHJldHVybiBlcnJvci50cmltKCkuc3BsaXQoXCJcXG5cIilbMF1cblxuICAgIHJldHVybiBTdHJpbmcoZXJyb3IgfHwgXCJCYWNrZ3JvdW5kIGpvYiBmYWlsZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhcyBzdHJpbmcgZmFpbHVyZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBSZXBvcnRlZCBmYWlsdXJlIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7ZXJyb3IgaXMgc3RyaW5nfSBXaGV0aGVyIHRoZSB2YWx1ZSBpcyBhIG5vbi1lbXB0eSBzdHJpbmcuXG4gICAqL1xuICBfaGFzU3RyaW5nRmFpbHVyZShlcnJvcikge1xuICAgIHJldHVybiB0eXBlb2YgZXJyb3IgPT09IFwic3RyaW5nXCIgJiYgZXJyb3IudHJpbSgpLmxlbmd0aCA+IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvcHkgc3RyaW5nIGZhaWx1cmUgc3RhY2suXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIFJlcG9ydGVkIGZhaWx1cmUgdmFsdWUuXG4gICAqIEBwYXJhbSB7RXJyb3J9IGFyZ3Mubm9ybWFsaXplZEVycm9yIC0gTm9ybWFsaXplZCBlcnJvci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfY29weVN0cmluZ0ZhaWx1cmVTdGFjayh7ZXJyb3IsIG5vcm1hbGl6ZWRFcnJvcn0pIHtcbiAgICBpZiAodGhpcy5faGFzU3RyaW5nRmFpbHVyZShlcnJvcikpIG5vcm1hbGl6ZWRFcnJvci5zdGFjayA9IGVycm9yXG4gIH1cblxuICAvKipcbiAgICogRHJhaW5zIGFsbCBkaXNwYXRjaGFibGUgam9icyB0byByZWFkeSB3b3JrZXJzLCB0aGVuIGFybXMgdGhlXG4gICAqIHNjaGVkdWxlZC1qb2IgdGltZXIgZm9yIHRoZSBuZXh0IGZ1dHVyZSBgc2NoZWR1bGVkX2F0X21zYC4gQ29hbGVzY2VzXG4gICAqIGNvbmN1cnJlbnQgdHJpZ2dlcnM6IGEgd2FrZS11cCB0aGF0IGxhbmRzIHdoaWxlIGEgZHJhaW4gaXMgaW5cbiAgICogZmxpZ2h0IGp1c3Qgc2V0cyBhIHJlLWRyYWluIGZsYWcgYW5kIGxldHMgdGhlIGluLWZsaWdodCBkcmFpblxuICAgKiByZS1sb29wIGFmdGVyIGl0IGZpbmlzaGVzLCBzbyBubyBzaWduYWwgaXMgZHJvcHBlZCBidXQgbm8gdHdvXG4gICAqIGRyYWlucyBydW4gaW4gcGFyYWxsZWwuXG4gICAqXG4gICAqIFJlc2lsaWVuY2U6IGluIGJlYWNvbiBtb2RlIHRoaXMgaXMgdGhlIHNvbGUgd2FrZS11cCBwYXRoIGZvclxuICAgKiBhbHJlYWR5LXF1ZXVlZCB3b3JrLCBzbyBhIHRyYW5zaWVudCBEQiBlcnJvciBkdXJpbmcgdGhlIGRyYWluIChlLmcuXG4gICAqIGBuZXh0QXZhaWxhYmxlSm9iKClgIHJlamVjdGluZykgbXVzdCBub3Qgc3RyYW5kIHRoZSBxdWV1ZSB1bnRpbCB0aGVcbiAgICogbmV4dCBleHRlcm5hbCBzaWduYWwuIE9uIGFueSBlcnJvciB3ZSBsb2cgaXQgYW5kIGFybSBhIG9uZS1zaG90XG4gICAqIHJldHJ5IHZpYSBgX3NjaGVkdWxlRXJyb3JSZXRyeWAgdXNpbmcgYHBvbGxJbnRlcnZhbE1zYCBhcyB0aGVcbiAgICogY2FkZW5jZTsgb24gc3VjY2VzcyB0aGUgcmV0cnkgdGltZXIgaXMgY2xlYXJlZC4gUG9sbGluZy1tb2RlIHJ1bnNcbiAgICogYF9kcmFpbmAgZnJvbSBpdHMgb3duIGludGVydmFsLCBzbyB0aGUgcmV0cnkgdGltZXIgaXMgYSBuby1vcCB0aGVyZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfZHJhaW4oKSB7XG4gICAgaWYgKHRoaXMuX3N0b3BwZWQgfHwgdGhpcy5saWZlY3ljbGVTdGF0ZSAhPT0gXCJhY3RpdmVcIiB8fCAhdGhpcy5fYWN0aXZlT3duZXJzaGlwUmVhZHkpIHJldHVyblxuXG4gICAgaWYgKHRoaXMuX2RyYWluUHJvbWlzZSkge1xuICAgICAgdGhpcy5fcmVkcmFpblF1ZXVlZCA9IHRydWVcbiAgICAgIGF3YWl0IHRoaXMuX2RyYWluUHJvbWlzZVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgZHJhaW5Qcm9taXNlID0gdGhpcy5fZHJhaW5Ub0NvbXBsZXRpb24oKVxuXG4gICAgdGhpcy5fZHJhaW5Qcm9taXNlID0gZHJhaW5Qcm9taXNlXG4gICAgYXdhaXQgZHJhaW5Qcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBvbmUgc2VyaWFsaXplZCBkcmFpbiBsaWZlY3ljbGUsIGluY2x1ZGluZyB0aW1lciByZS1hcm1pbmcuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGV2ZXJ5IGNvYWxlc2NlZCByZXF1ZXN0IGlzIGhhbmRsZWQuXG4gICAqL1xuICBhc3luYyBfZHJhaW5Ub0NvbXBsZXRpb24oKSB7XG4gICAgdGhpcy5fZHJhaW5pbmcgPSB0cnVlXG5cbiAgICB0cnkge1xuICAgICAgbGV0IGVycm9yZWRcblxuICAgICAgZG8ge1xuICAgICAgICBlcnJvcmVkID0gYXdhaXQgdGhpcy5fZHJhaW5VbnRpbElkbGUoKVxuICAgICAgICBhd2FpdCB0aGlzLl9maW5pc2hEcmFpbih7ZXJyb3JlZH0pXG4gICAgICB9IHdoaWxlICghZXJyb3JlZCAmJiB0aGlzLl9yZWRyYWluUXVldWVkICYmICF0aGlzLl9zdG9wcGVkICYmIHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwiYWN0aXZlXCIpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX2RyYWluaW5nID0gZmFsc2VcbiAgICAgIHRoaXMuX2RyYWluUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmlzaCBkcmFpbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MuZXJyb3JlZCAtIFdoZXRoZXIgdGhlIGRyYWluIGhpdCBhbiBlcnJvci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZm9sbG93LXVwIHRpbWVycyBhcmUgaGFuZGxlZC5cbiAgICovXG4gIGFzeW5jIF9maW5pc2hEcmFpbih7ZXJyb3JlZH0pIHtcbiAgICBpZiAodGhpcy5fc3RvcHBlZCB8fCB0aGlzLmxpZmVjeWNsZVN0YXRlICE9PSBcImFjdGl2ZVwiKSByZXR1cm5cbiAgICBpZiAoZXJyb3JlZCkgcmV0dXJuIHRoaXMuX3NjaGVkdWxlRXJyb3JSZXRyeSgpXG5cbiAgICBhd2FpdCB0aGlzLl9hcm1TY2hlZHVsZWRUaW1lck9yUmV0cnkoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXJtIHNjaGVkdWxlZCB0aW1lciBvciByZXRyeS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgc2NoZWR1bGVkIHRpbWVyIGhhbmRsaW5nLlxuICAgKi9cbiAgYXN5bmMgX2FybVNjaGVkdWxlZFRpbWVyT3JSZXRyeSgpIHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fYXJtU2NoZWR1bGVkVGltZXIoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJCYWNrZ3JvdW5kIGpvYnMgc2NoZWR1bGVkLXRpbWVyIGFybWluZyBmYWlsZWQ6XCIsIGVycm9yXSlcbiAgICAgIHRoaXMuX3NjaGVkdWxlRXJyb3JSZXRyeSgpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9jbGVhckVycm9yUmV0cnlUaW1lcigpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGVhciBlcnJvciByZXRyeSB0aW1lci5cbiAgICogQHJldHVybnMge3ZvaWR9ICovXG4gIF9jbGVhckVycm9yUmV0cnlUaW1lcigpIHtcbiAgICBpZiAodGhpcy5wZW5kaW5nSGFuZG9mZlJlY292ZXJpZXMuc2l6ZSA+IDApIHJldHVyblxuICAgIGlmICh0aGlzLl9zdGFydHVwSGFuZG9mZkdyYWNlRWxhcHNlZCAmJiB0aGlzLnN0YXJ0dXBIYW5kb2ZmU25hcHNob3QubGVuZ3RoID4gMCkgcmV0dXJuXG5cbiAgICBmb3IgKGNvbnN0IHdvcmtlciBvZiB0aGlzLndvcmtlckhhbmRvZmZzLmtleXMoKSkge1xuICAgICAgaWYgKCF0aGlzLndvcmtlcnMuaGFzKHdvcmtlcikpIHJldHVyblxuICAgIH1cblxuICAgIGlmICh0aGlzLl9lcnJvclJldHJ5VGltZXIpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLl9lcnJvclJldHJ5VGltZXIpXG4gICAgICB0aGlzLl9lcnJvclJldHJ5VGltZXIgPSB1bmRlZmluZWRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBkcmFpbiB1bnRpbCBpZGxlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBkcmFpbiBoaXQgYW4gZXJyb3IuXG4gICAqL1xuICBhc3luYyBfZHJhaW5VbnRpbElkbGUoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3J1bkRyYWluTG9vcCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gZHJhaW4gbG9vcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgZHJhaW4gaGl0IGFuIGVycm9yLlxuICAgKi9cbiAgYXN5bmMgX3J1bkRyYWluTG9vcCgpIHtcbiAgICBkbyB7XG4gICAgICB0aGlzLl9yZWRyYWluUXVldWVkID0gZmFsc2VcbiAgICAgIGNvbnN0IGVycm9yZWQgPSBhd2FpdCB0aGlzLl9kcmFpbk9uY2VXaXRoRXJyb3JSZXBvcnQoKVxuXG4gICAgICBpZiAoZXJyb3JlZCkgcmV0dXJuIHRydWVcbiAgICB9IHdoaWxlICh0aGlzLl9yZWRyYWluUXVldWVkICYmICF0aGlzLl9zdG9wcGVkKVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkcmFpbiBvbmNlIHdpdGggZXJyb3IgcmVwb3J0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIG9uZSBkcmFpbiBwYXNzIGZhaWxlZC5cbiAgICovXG4gIGFzeW5jIF9kcmFpbk9uY2VXaXRoRXJyb3JSZXBvcnQoKSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX2RyYWluT25jZSgpXG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiQmFja2dyb3VuZCBqb2JzIGRyYWluIGZhaWxlZDpcIiwgZXJyb3JdKVxuICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgVGltZW91dEVycm9yKSB0aGlzLl9yZXBvcnREcmFpblN0YWxsRXJyb3IoZXJyb3IpXG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBCb3VuZHMgb25lIGRyYWluLWNyaXRpY2FsIHN0b3JlIG9wZXJhdGlvbiBzbyBhIHN0b3JlIGNhbGwgdGhhdCBuZXZlclxuICAgKiBzZXR0bGVzIHJlamVjdHMgaW50byB0aGUgZHJhaW4gZXJyb3IvcmV0cnkgcGF0aCBpbnN0ZWFkIG9mIHN0YWxsaW5nIHRoZVxuICAgKiBjb2FsZXNjZWQgZHJhaW4gYW5kIGV2ZXJ5IGxhdGVyIGRpc3BhdGNoIHF1ZXVlZCBiZWhpbmQgaXQuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBvcGVyYXRpb24gLSBPcGVyYXRpb24gbGFiZWwgZm9yIHRoZSB0aW1lb3V0IGVycm9yLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gRHJhaW4gc3RvcmUgb3BlcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBPcGVyYXRpb24gcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX2JvdW5kZWREcmFpblN0b3JlT3BlcmF0aW9uKG9wZXJhdGlvbiwgY2FsbGJhY2spIHtcbiAgICByZXR1cm4gYXdhaXQgdGltZW91dCh7XG4gICAgICBlcnJvck1lc3NhZ2U6IGBCYWNrZ3JvdW5kIGpvYnMgZHJhaW4gc3RvcmUgb3BlcmF0aW9uIHRpbWVkIG91dCBhZnRlciAke3RoaXMuZHJhaW5TdG9yZU9wZXJhdGlvblRpbWVvdXRNc31tczogJHtvcGVyYXRpb259YCxcbiAgICAgIHRpbWVvdXQ6IHRoaXMuZHJhaW5TdG9yZU9wZXJhdGlvblRpbWVvdXRNc1xuICAgIH0sIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFN1cmZhY2VzIGEgZHJhaW4gcGFzcyB3aG9zZSBzdG9yZSBvcGVyYXRpb24gbmV2ZXIgc2V0dGxlZC4gVGhlIGJvdW5kZWRcbiAgICogc3RvcmUgdGltZW91dCBrZWVwcyBkaXNwYXRjaCBtb3ZpbmcgdGhyb3VnaCB0aGUgZXJyb3ItcmV0cnkgcGF0aDsgdGhpc1xuICAgKiByZXBvcnQgbWFrZXMgdGhlIHN0YWxsIG9ic2VydmFibGUgZm9yIHByb2Nlc3MtbGV2ZWwgYnVnIHJlcG9ydGVycy5cbiAgICogQHBhcmFtIHtFcnJvcn0gZXJyb3IgLSBEcmFpbiBzdGFsbCBmYWlsdXJlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXBvcnREcmFpblN0YWxsRXJyb3IoZXJyb3IpIHtcbiAgICBjb25zdCBwYXlsb2FkID0ge1xuICAgICAgY29udGV4dDoge1xuICAgICAgICBzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYnMtZHJhaW4tc3RhbGxcIixcbiAgICAgICAgZHJhaW5TdG9yZU9wZXJhdGlvblRpbWVvdXRNczogdGhpcy5kcmFpblN0b3JlT3BlcmF0aW9uVGltZW91dE1zLFxuICAgICAgICBkaXNwYXRjaFN0cmF0ZWd5OiB0aGlzLmRpc3BhdGNoU3RyYXRlZ3lcbiAgICAgIH0sXG4gICAgICBlcnJvclxuICAgIH1cbiAgICBjb25zdCBlcnJvckV2ZW50cyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpXG5cbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiZnJhbWV3b3JrLWVycm9yXCIsIHBheWxvYWQpXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4ucGF5bG9hZCwgZXJyb3JUeXBlOiBcImZyYW1ld29yay1lcnJvclwifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcm1zIGEgb25lLXNob3QgYHNldFRpbWVvdXRgIHRvIHJldHJ5IGBfZHJhaW5gIGFmdGVyIGEgdHJhbnNpZW50XG4gICAqIGZhaWx1cmUuIElkZW1wb3RlbnQg4oCUIHJlcGVhdGVkIGNhbGxzIHdoaWxlIGEgcmV0cnkgaXMgYWxyZWFkeVxuICAgKiBwZW5kaW5nIGFyZSBuby1vcHMuIFBvbGxpbmcgbW9kZSBhbHJlYWR5IHJldHJpZXMgdmlhIGl0cyBvd25cbiAgICogaW50ZXJ2YWwsIHNvIHRoaXMgaXMgYSBuby1vcCBpbiB0aGF0IG1vZGUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3NjaGVkdWxlRXJyb3JSZXRyeSgpIHtcbiAgICBpZiAodGhpcy5fc3RvcHBlZCkgcmV0dXJuXG4gICAgaWYgKHRoaXMuX2Vycm9yUmV0cnlUaW1lcikgcmV0dXJuXG4gICAgaWYgKHRoaXMuZGlzcGF0Y2hTdHJhdGVneSA9PT0gXCJwb2xsaW5nXCIgJiYgdGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJhY3RpdmVcIikgcmV0dXJuXG5cbiAgICB0aGlzLl9lcnJvclJldHJ5VGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMuX2Vycm9yUmV0cnlUaW1lciA9IHVuZGVmaW5lZFxuICAgICAgdm9pZCB0aGlzLl9yZXRyeUFmdGVyRXJyb3IoKVxuICAgIH0sIHRoaXMucG9sbEludGVydmFsTXMpXG4gIH1cblxuICAvKipcbiAgICogUmV0cmllcyBmYWlsZWQgcHJlLWRpc3BhdGNoIGFuZCBkaXNjb25uZWN0ZWQtc29ja2V0IHJlbGVhc2VzIGJlZm9yZVxuICAgKiBkcmFpbmluZyBxdWV1ZWQgd29yay5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcmV0cnkgd29yay5cbiAgICovXG4gIGFzeW5jIF9yZXRyeUFmdGVyRXJyb3IoKSB7XG4gICAgaWYgKHRoaXMuX3N0b3BwZWQpIHJldHVyblxuXG4gICAgaWYgKHRoaXMuX3N0YXJ0dXBIYW5kb2ZmR3JhY2VFbGFwc2VkICYmIHRoaXMuc3RhcnR1cEhhbmRvZmZTbmFwc2hvdC5sZW5ndGggPiAwKSB7XG4gICAgICBhd2FpdCB0aGlzLl9zdGFydFN0YXJ0dXBIYW5kb2ZmUmVjbGFpbSgpXG4gICAgICBpZiAodGhpcy5zdGFydHVwSGFuZG9mZlNuYXBzaG90Lmxlbmd0aCA+IDApIHJldHVyblxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl9yZXRyeVBlbmRpbmdIYW5kb2ZmUmVjb3ZlcmllcygpXG4gICAgfSBjYXRjaCB7XG4gICAgICB0aGlzLl9zY2hlZHVsZUVycm9yUmV0cnkoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGZvciAoY29uc3Qgd29ya2VyIG9mIHRoaXMud29ya2VySGFuZG9mZnMua2V5cygpKSB7XG4gICAgICAgIGlmICghdGhpcy53b3JrZXJzLmhhcyh3b3JrZXIpKSBhd2FpdCB0aGlzLl9yZWxlYXNlV29ya2VySGFuZG9mZnMod29ya2VyKVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLl9yZXBvcnRIYW5kb2ZmUmVsZWFzZUVycm9yKGVycm9yKVxuICAgICAgdGhpcy5fc2NoZWR1bGVFcnJvclJldHJ5KClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmICh0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcImFjdGl2ZVwiKSBhd2FpdCB0aGlzLl9kcmFpbigpXG4gICAgdGhpcy5fbWF5YmVTdG9wUmV0aXJlZCgpXG4gIH1cblxuICAvKipcbiAgICogSW5uZXIgZHJhaW4gbG9vcDogcHVsbHMgZWxpZ2libGUgcXVldWVkIGpvYnMgYW5kIGhhbmRzIHRoZW0gb2ZmIHRvXG4gICAqIHJlYWR5IHdvcmtlcnMgdW50aWwgb25lIG9mIHRoZW0gcnVucyBvdXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2RyYWluT25jZSgpIHtcbiAgICB3aGlsZSAodGhpcy5yZWFkeVdvcmtlcnMuc2l6ZSA+IDAgJiYgIXRoaXMuX3N0b3BwZWQgJiYgdGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJhY3RpdmVcIiAmJiB0aGlzLl9hY3RpdmVPd25lcnNoaXBSZWFkeSkge1xuICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fYm91bmRlZERyYWluU3RvcmVPcGVyYXRpb24oXCJuZXh0LWF2YWlsYWJsZS1qb2JcIiwgYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5uZXh0QXZhaWxhYmxlSm9iRm9yUmVhZHlXb3JrZXJzKCkpXG4gICAgICBpZiAoIWpvYikgcmV0dXJuXG5cbiAgICAgIGNvbnN0IHdvcmtlciA9IHRoaXMucmVhZHlXb3JrZXJGb3JKb2Ioam9iKVxuICAgICAgaWYgKCF3b3JrZXIpIHJldHVyblxuXG4gICAgICBjb25zdCBhZG1pc3Npb24gPSB0aGlzLl9jb25zdW1lV29ya2VyQWRtaXNzaW9uKHtqb2IsIHdvcmtlcn0pXG4gICAgICBjb25zdCByZXF1ZXN0ZWRIYW5kb2ZmSWQgPSByYW5kb21VVUlEKClcbiAgICAgIGxldCBoYW5kb2ZmXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGhhbmRvZmYgPSBhd2FpdCB0aGlzLl9ib3VuZGVkRHJhaW5TdG9yZU9wZXJhdGlvbihcIm1hcmstaGFuZGVkLW9mZlwiLCBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLnN0b3JlLm1hcmtIYW5kZWRPZmYoe2hhbmRvZmZJZDogcmVxdWVzdGVkSGFuZG9mZklkLCBqb2JJZDogam9iLmlkLCB3b3JrZXJJZDogd29ya2VyLndvcmtlcklkfSkpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aGlzLl9yZW1lbWJlckhhbmRvZmZSZWNvdmVyeSh7aGFuZG9mZklkOiByZXF1ZXN0ZWRIYW5kb2ZmSWQsIGpvYklkOiBqb2IuaWR9KVxuICAgICAgICB0aGlzLl9yZXN0b3JlV29ya2VyQWRtaXNzaW9uKHsuLi5hZG1pc3Npb24sIHdvcmtlcn0pXG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLl9ib3VuZGVkRHJhaW5TdG9yZU9wZXJhdGlvbihcInJlY292ZXItaGFuZG9mZlwiLCBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLl9yZWNvdmVySGFuZG9mZih7aGFuZG9mZklkOiByZXF1ZXN0ZWRIYW5kb2ZmSWQsIGpvYklkOiBqb2IuaWR9KSlcbiAgICAgICAgfSBjYXRjaCAocmVjb3ZlcnlFcnJvcikge1xuICAgICAgICAgIHRoaXMuX3JlcG9ydEhhbmRvZmZSZWNvdmVyeUVycm9yKHtlcnJvcjogcmVjb3ZlcnlFcnJvciwgaGFuZG9mZklkOiByZXF1ZXN0ZWRIYW5kb2ZmSWQsIGpvYklkOiBqb2IuaWR9KVxuICAgICAgICB9XG5cbiAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgIH1cblxuICAgICAgaWYgKCFoYW5kb2ZmKSB7XG4gICAgICAgIHRoaXMuX3Jlc3RvcmVXb3JrZXJBZG1pc3Npb24oey4uLmFkbWlzc2lvbiwgd29ya2VyfSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5hZnRlckhhbmRvZmZDbGFpbT8uKHtoYW5kb2ZmLCBqb2J9KVxuXG4gICAgICBjb25zdCBoYW5kb2ZmcyA9IHRoaXMud29ya2VySGFuZG9mZnMuZ2V0KHdvcmtlcilcblxuICAgICAgaWYgKCFoYW5kb2ZmcyB8fCAhdGhpcy53b3JrZXJzLmhhcyh3b3JrZXIpIHx8IHdvcmtlci5pc0RyYWluaW5nIHx8IHRoaXMubGlmZWN5Y2xlU3RhdGUgIT09IFwiYWN0aXZlXCIgfHwgIXRoaXMuX2FjdGl2ZU93bmVyc2hpcFJlYWR5KSB7XG4gICAgICAgIHRoaXMuX3JlbWVtYmVySGFuZG9mZlJlY292ZXJ5KHtoYW5kb2ZmSWQ6IGhhbmRvZmYuaGFuZG9mZklkLCBqb2JJZDogam9iLmlkfSlcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLl9ib3VuZGVkRHJhaW5TdG9yZU9wZXJhdGlvbihcInJlY292ZXItaGFuZG9mZlwiLCBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLl9yZWNvdmVySGFuZG9mZih7aGFuZG9mZklkOiBoYW5kb2ZmLmhhbmRvZmZJZCwgam9iSWQ6IGpvYi5pZH0pKVxuICAgICAgICB9IGNhdGNoIChyZWNvdmVyeUVycm9yKSB7XG4gICAgICAgICAgdGhpcy5fcmVwb3J0SGFuZG9mZlJlY292ZXJ5RXJyb3Ioe2Vycm9yOiByZWNvdmVyeUVycm9yLCBoYW5kb2ZmSWQ6IGhhbmRvZmYuaGFuZG9mZklkLCBqb2JJZDogam9iLmlkfSlcbiAgICAgICAgICB0aHJvdyByZWNvdmVyeUVycm9yXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fbm90aWZ5RW5xdWV1ZWQoKVxuICAgICAgICB0aGlzLl9yZWRyYWluUXVldWVkID0gdHJ1ZVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICB0aGlzLl9maW5hbGl6ZVdvcmtlckFkbWlzc2lvbih7Li4uYWRtaXNzaW9uLCBqb2IsIHdvcmtlcn0pXG4gICAgICBoYW5kb2Zmcy5zZXQoam9iLmlkLCBoYW5kb2ZmLmhhbmRvZmZJZClcblxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgZGlzcGF0Y2hlZEpvYiA9IGhhbmRvZmYuam9iIHx8IGpvYlxuXG4gICAgICAgIHdvcmtlci5zZW5kKHtcbiAgICAgICAgICB0eXBlOiBcImpvYlwiLFxuICAgICAgICAgIHBheWxvYWQ6IHtcbiAgICAgICAgICAgIGlkOiBkaXNwYXRjaGVkSm9iLmlkLFxuICAgICAgICAgICAgam9iTmFtZTogZGlzcGF0Y2hlZEpvYi5qb2JOYW1lLFxuICAgICAgICAgICAgYXJnczogZGlzcGF0Y2hlZEpvYi5hcmdzLFxuICAgICAgICAgICAgaGFuZG9mZklkOiBoYW5kb2ZmLmhhbmRvZmZJZCxcbiAgICAgICAgICAgIHdvcmtlcklkOiB3b3JrZXIud29ya2VySWQsXG4gICAgICAgICAgICBoYW5kZWRPZmZBdE1zOiBoYW5kb2ZmLmhhbmRlZE9mZkF0TXMsXG4gICAgICAgICAgICBvcHRpb25zOiB7XG4gICAgICAgICAgICAgIGNvbmN1cnJlbmN5S2V5OiBkaXNwYXRjaGVkSm9iLmNvbmN1cnJlbmN5S2V5IHx8IHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgZXhlY3V0aW9uTW9kZTogZGlzcGF0Y2hlZEpvYi5leGVjdXRpb25Nb2RlLFxuICAgICAgICAgICAgICBtYXhDb25jdXJyZW5jeTogZGlzcGF0Y2hlZEpvYi5tYXhDb25jdXJyZW5jeSA/PyB1bmRlZmluZWQsXG4gICAgICAgICAgICAgIG1heFJldHJpZXM6IGRpc3BhdGNoZWRKb2IubWF4UmV0cmllcyA/PyB1bmRlZmluZWQsXG4gICAgICAgICAgICAgIHF1ZXVlOiBkaXNwYXRjaGVkSm9iLnF1ZXVlLFxuICAgICAgICAgICAgICBzY2hlZHVsZWRBdE1zOiBkaXNwYXRjaGVkSm9iLnNjaGVkdWxlZEF0TXMgPz8gdW5kZWZpbmVkLFxuICAgICAgICAgICAgICAuLi4oZGlzcGF0Y2hlZEpvYi50aW1lb3V0TXMgPT09IG51bGwgPyB7fSA6IHt0aW1lb3V0TXM6IGRpc3BhdGNoZWRKb2IudGltZW91dE1zfSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aGlzLmxvZ2dlci53YXJuKCgpID0+IFtcIkZhaWxlZCB0byBzZW5kIGpvYiB0byB3b3JrZXIsIHJlLXF1ZXVlaW5nOlwiLCBlcnJvcl0pXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgd29ya2VyLmNsb3NlKClcbiAgICAgICAgfSBjYXRjaCAoY2xvc2VFcnJvcikge1xuICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oKCkgPT4gW1wiRmFpbGVkIHRvIGNsb3NlIHdvcmtlciBhZnRlciBqb2Igc2VuZCBmYWlsdXJlOlwiLCBjbG9zZUVycm9yXSlcbiAgICAgICAgfVxuICAgICAgICBhd2FpdCB0aGlzLl9oYW5kbGVXb3JrZXJTb2NrZXRDbG9zZWQod29ya2VyLCB7cXVldWVSZWRyYWluOiB0cnVlfSlcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ29uc3VtZXMgb25lIGFkdmVydGlzZWQgd29ya2VyIGFkbWlzc2lvbiB3aGlsZSBwZXJzaXN0ZW5jZSBpcyBpbiBmbGlnaHQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQWRtaXNzaW9uIGRldGFpbHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBhcmdzLmpvYiAtIFNlbGVjdGVkIGpvYi5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLndvcmtlciAtIFNlbGVjdGVkIHdvcmtlciBzb2NrZXQuXG4gICAqIEByZXR1cm5zIHt7cG9vbGVkQ3JlZGl0Q29uc3VtZWQ6IGJvb2xlYW4sIHJlYWRpbmVzc1ZlcnNpb246IG51bWJlcn19IC0gUmV2ZXJzaWJsZSBhZG1pc3Npb24gZGViaXQuXG4gICAqL1xuICBfY29uc3VtZVdvcmtlckFkbWlzc2lvbih7am9iLCB3b3JrZXJ9KSB7XG4gICAgbGV0IHBvb2xlZENyZWRpdENvbnN1bWVkID0gZmFsc2VcblxuICAgIHRoaXMucmVhZHlXb3JrZXJzLmRlbGV0ZSh3b3JrZXIpXG5cbiAgICBpZiAoam9iLmV4ZWN1dGlvbk1vZGUgPT09IFwicG9vbGVkXCIgJiYgd29ya2VyLnVzZXNQb29sZWRDYXBhY2l0eUNyZWRpdHMgJiYgd29ya2VyLmF2YWlsYWJsZVBvb2xlZFNsb3RzID4gMCkge1xuICAgICAgcG9vbGVkQ3JlZGl0Q29uc3VtZWQgPSB0cnVlXG4gICAgICB3b3JrZXIuYXZhaWxhYmxlUG9vbGVkU2xvdHMgLT0gMVxuICAgICAgaWYgKHdvcmtlci5hdmFpbGFibGVQb29sZWRTbG90cyA+IDApIHRoaXMucmVhZHlXb3JrZXJzLmFkZCh3b3JrZXIpXG4gICAgfVxuXG4gICAgcmV0dXJuIHtwb29sZWRDcmVkaXRDb25zdW1lZCwgcmVhZGluZXNzVmVyc2lvbjogd29ya2VyLnJlYWRpbmVzc1ZlcnNpb259XG4gIH1cblxuICAvKipcbiAgICogUmVzdG9yZXMgYW4gYWRtaXNzaW9uIHRoYXQgbmV2ZXIgcmVhY2hlZCBhIHdvcmtlci4gQSBuZXdlciByZWFkaW5lc3NcbiAgICogYWR2ZXJ0aXNlbWVudCBpcyBhbHJlYWR5IGF1dGhvcml0YXRpdmUsIHNvIGl0cyBwb29sZWQgY291bnQgaXMgbm90IGNoYW5nZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQWRtaXNzaW9uIGRldGFpbHMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5wb29sZWRDcmVkaXRDb25zdW1lZCAtIFdoZXRoZXIgYSBwb29sZWQgY3JlZGl0IHdhcyBkZWJpdGVkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5yZWFkaW5lc3NWZXJzaW9uIC0gUmVhZGluZXNzIGdlbmVyYXRpb24gYXQgZGViaXQgdGltZS5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLndvcmtlciAtIFNlbGVjdGVkIHdvcmtlciBzb2NrZXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3Jlc3RvcmVXb3JrZXJBZG1pc3Npb24oe3Bvb2xlZENyZWRpdENvbnN1bWVkLCByZWFkaW5lc3NWZXJzaW9uLCB3b3JrZXJ9KSB7XG4gICAgaWYgKHRoaXMuX3N0b3BwZWQgfHwgdGhpcy5saWZlY3ljbGVTdGF0ZSAhPT0gXCJhY3RpdmVcIiB8fCAhdGhpcy5fYWN0aXZlT3duZXJzaGlwUmVhZHkgfHwgIXRoaXMud29ya2Vycy5oYXMod29ya2VyKSB8fCB3b3JrZXIuaXNEcmFpbmluZykgcmV0dXJuXG5cbiAgICBpZiAocG9vbGVkQ3JlZGl0Q29uc3VtZWQgJiYgd29ya2VyLnJlYWRpbmVzc1ZlcnNpb24gPT09IHJlYWRpbmVzc1ZlcnNpb24pIHtcbiAgICAgIHdvcmtlci5hdmFpbGFibGVQb29sZWRTbG90cyArPSAxXG4gICAgfVxuXG4gICAgaWYgKHdvcmtlci5zdXBwb3J0c0hhbmRvZmZJZFJlcG9ydGluZykgdGhpcy5yZWFkeVdvcmtlcnMuYWRkKHdvcmtlcilcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIGEgc3VjY2Vzc2Z1bCBwb29sZWQgYWRtaXNzaW9uIHRvIGEgcmVhZGluZXNzIGFkdmVydGlzZW1lbnQgdGhhdFxuICAgKiBhcnJpdmVkIHdoaWxlIHBlcnNpc3RlbmNlIHdhcyBpbiBmbGlnaHQgYW5kIHJlcGxhY2VkIHRoZSBlYXJsaWVyIGRlYml0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFkbWlzc2lvbiBkZXRhaWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gYXJncy5qb2IgLSBTZWxlY3RlZCBqb2IuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5wb29sZWRDcmVkaXRDb25zdW1lZCAtIFdoZXRoZXIgYSBwb29sZWQgY3JlZGl0IHdhcyBkZWJpdGVkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5yZWFkaW5lc3NWZXJzaW9uIC0gUmVhZGluZXNzIGdlbmVyYXRpb24gYXQgZGViaXQgdGltZS5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLndvcmtlciAtIFNlbGVjdGVkIHdvcmtlciBzb2NrZXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2ZpbmFsaXplV29ya2VyQWRtaXNzaW9uKHtqb2IsIHBvb2xlZENyZWRpdENvbnN1bWVkLCByZWFkaW5lc3NWZXJzaW9uLCB3b3JrZXJ9KSB7XG4gICAgaWYgKCFwb29sZWRDcmVkaXRDb25zdW1lZCB8fCBqb2IuZXhlY3V0aW9uTW9kZSAhPT0gXCJwb29sZWRcIikgcmV0dXJuXG4gICAgaWYgKHdvcmtlci5yZWFkaW5lc3NWZXJzaW9uID09PSByZWFkaW5lc3NWZXJzaW9uIHx8ICF3b3JrZXIudXNlc1Bvb2xlZENhcGFjaXR5Q3JlZGl0cykgcmV0dXJuXG4gICAgaWYgKHdvcmtlci5hdmFpbGFibGVQb29sZWRTbG90cyA8PSAwKSByZXR1cm5cblxuICAgIHdvcmtlci5hdmFpbGFibGVQb29sZWRTbG90cyAtPSAxXG4gICAgaWYgKHdvcmtlci5hdmFpbGFibGVQb29sZWRTbG90cyA9PT0gMCkgdGhpcy5yZWFkeVdvcmtlcnMuZGVsZXRlKHdvcmtlcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXRhaW5zIGFuIGV4YWN0IGxlYXNlIGZvciBpZGVtcG90ZW50IHByZS1kaXNwYXRjaCByZWNvdmVyeS5cbiAgICogQHBhcmFtIHt7aGFuZG9mZklkOiBzdHJpbmcsIGpvYklkOiBzdHJpbmd9fSBhcmdzIC0gRXhhY3QgcmVjb3ZlcnkgZmVuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlbWVtYmVySGFuZG9mZlJlY292ZXJ5KHtoYW5kb2ZmSWQsIGpvYklkfSkge1xuICAgIHRoaXMucGVuZGluZ0hhbmRvZmZSZWNvdmVyaWVzLnNldChoYW5kb2ZmSWQsIGpvYklkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgb25lIGV4YWN0IGxlYXNlIGFuZCBmb3JnZXRzIGl0IG9ubHkgYWZ0ZXIgdGhlIGFkYXB0ZXIgYWNrbm93bGVkZ2VzXG4gICAqIHRoZSBmZW5jZWQgdHJhbnNpdGlvbiBvciBjb25maXJtcyBpdCB3YXMgYWxyZWFkeSBhYnNlbnQuXG4gICAqIEBwYXJhbSB7e2hhbmRvZmZJZDogc3RyaW5nLCBqb2JJZDogc3RyaW5nfX0gYXJncyAtIEV4YWN0IHJlY292ZXJ5IGZlbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBkdXJhYmxlIHJlY292ZXJ5IHNldHRsZXMuXG4gICAqL1xuICBhc3luYyBfcmVjb3ZlckhhbmRvZmYoe2hhbmRvZmZJZCwgam9iSWR9KSB7XG4gICAgYXdhaXQgdGhpcy5zdG9yZS5tYXJrUmV0dXJuZWRUb1F1ZXVlKHtoYW5kb2ZmSWQsIGpvYklkfSlcblxuICAgIGlmICh0aGlzLnBlbmRpbmdIYW5kb2ZmUmVjb3Zlcmllcy5nZXQoaGFuZG9mZklkKSA9PT0gam9iSWQpIHtcbiAgICAgIHRoaXMucGVuZGluZ0hhbmRvZmZSZWNvdmVyaWVzLmRlbGV0ZShoYW5kb2ZmSWQpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcGxheXMgcmV0YWluZWQgZXhhY3QtSUQgcmVjb3ZlcmllcyB0aHJvdWdoIHRoZSBkaXNwYXRjaGVyJ3MgZXhpc3RpbmdcbiAgICogdHJhbnNpZW50LWVycm9yIHJldHJ5IGxpZmVjeWNsZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZXZlcnkgcmV0YWluZWQgcmVjb3Zlcnkgc2V0dGxlcy5cbiAgICovXG4gIGFzeW5jIF9yZXRyeVBlbmRpbmdIYW5kb2ZmUmVjb3ZlcmllcygpIHtcbiAgICBmb3IgKGNvbnN0IFtoYW5kb2ZmSWQsIGpvYklkXSBvZiBbLi4udGhpcy5wZW5kaW5nSGFuZG9mZlJlY292ZXJpZXNdKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLl9yZWNvdmVySGFuZG9mZih7aGFuZG9mZklkLCBqb2JJZH0pXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aGlzLl9yZXBvcnRIYW5kb2ZmUmVjb3ZlcnlFcnJvcih7ZXJyb3IsIGhhbmRvZmZJZCwgam9iSWR9KVxuICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTdXJmYWNlcyBhIGZhaWxlZCBleGFjdC1JRCByZWNvdmVyeSB3aXRob3V0IGRyb3BwaW5nIGl0cyByZXRyeSBsZWRnZXIgZW50cnkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUmVjb3ZlcnkgZmFpbHVyZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIEFkYXB0ZXIgZmFpbHVyZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuaGFuZG9mZklkIC0gRXhhY3QgbGVhc2UgZmVuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXBvcnRIYW5kb2ZmUmVjb3ZlcnlFcnJvcih7ZXJyb3IsIGhhbmRvZmZJZCwgam9iSWR9KSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG4gICAgY29uc3QgcGF5bG9hZCA9IHtcbiAgICAgIGNvbnRleHQ6IHtoYW5kb2ZmSWQsIGpvYklkLCBzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi1oYW5kb2ZmLWFkbWlzc2lvbi1yZWNvdmVyeVwifSxcbiAgICAgIGVycm9yOiBub3JtYWxpemVkRXJyb3JcbiAgICB9XG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiRmFpbGVkIHRvIHJlY292ZXIgYW4gYW1iaWd1b3VzIGJhY2tncm91bmQgam9iIGhhbmRvZmY6XCIsIG5vcm1hbGl6ZWRFcnJvcl0pXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBuZXh0IGF2YWlsYWJsZSBqb2IgZm9yIHJlYWR5IHdvcmtlcnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIE5leHQgcXVldWVkIGpvYiBtYXRjaGluZyByZWFkeSB3b3JrZXIgY2FwYWNpdHkuXG4gICAqL1xuICBhc3luYyBuZXh0QXZhaWxhYmxlSm9iRm9yUmVhZHlXb3JrZXJzKCkge1xuICAgIGNvbnN0IGV4ZWN1dGlvbk1vZGVzID0gdGhpcy5yZWFkeVdvcmtlckV4ZWN1dGlvbk1vZGVzKClcblxuICAgIGlmIChleGVjdXRpb25Nb2Rlcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsXG4gICAgaWYgKGV4ZWN1dGlvbk1vZGVzLmxlbmd0aCA9PT0gV09SS0VSX0VYRUNVVElPTl9NT0RFX0NBUEFCSUxJVElFUy5sZW5ndGgpIHJldHVybiBhd2FpdCB0aGlzLnN0b3JlLm5leHRBdmFpbGFibGVKb2IoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuc3RvcmUubmV4dEF2YWlsYWJsZUpvYih7ZXhlY3V0aW9uTW9kZTogZXhlY3V0aW9uTW9kZXN9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVhZHkgd29ya2VyIGV4ZWN1dGlvbiBtb2Rlcy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGVbXX0gLSBFeGVjdXRpb24gbW9kZXMgY3VycmVudGx5IGFjY2VwdGVkIGJ5IHJlYWR5IHdvcmtlcnMuXG4gICAqL1xuICByZWFkeVdvcmtlckV4ZWN1dGlvbk1vZGVzKCkge1xuICAgIGNvbnN0IGV4ZWN1dGlvbk1vZGVzID0gbmV3IFNldCgpXG5cbiAgICBmb3IgKGNvbnN0IHdvcmtlciBvZiB0aGlzLnJlYWR5V29ya2Vycykge1xuICAgICAgdGhpcy5fYWRkQWNjZXB0ZWRFeGVjdXRpb25Nb2Rlcyh7ZXhlY3V0aW9uTW9kZXMsIHdvcmtlcn0pXG4gICAgfVxuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZVtdfSAqLyAoWy4uLmV4ZWN1dGlvbk1vZGVzXSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFkZCBhY2NlcHRlZCBleGVjdXRpb24gbW9kZXMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtTZXQ8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZT59IGFyZ3MuZXhlY3V0aW9uTW9kZXMgLSBBY2NlcHRlZCBtb2Rlcy5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLndvcmtlciAtIFdvcmtlciBzb2NrZXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2FkZEFjY2VwdGVkRXhlY3V0aW9uTW9kZXMoe2V4ZWN1dGlvbk1vZGVzLCB3b3JrZXJ9KSB7XG4gICAgaWYgKCF3b3JrZXIuc3VwcG9ydHNIYW5kb2ZmSWRSZXBvcnRpbmcpIHJldHVyblxuXG4gICAgZm9yIChjb25zdCBjYXBhYmlsaXR5IG9mIFdPUktFUl9FWEVDVVRJT05fTU9ERV9DQVBBQklMSVRJRVMpIHtcbiAgICAgIGlmIChjYXBhYmlsaXR5LmFjY2VwdHMod29ya2VyKSkgZXhlY3V0aW9uTW9kZXMuYWRkKGNhcGFiaWxpdHkuZXhlY3V0aW9uTW9kZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWFkeSB3b3JrZXIgZm9yIGpvYi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGpvYiAtIEpvYiBiZWluZyBoYW5kZWQgb2ZmLlxuICAgKiBAcmV0dXJucyB7SnNvblNvY2tldCB8IHVuZGVmaW5lZH0gLSBSZWFkeSB3b3JrZXIgZm9yIHRoZSBqb2IgdHlwZS5cbiAgICovXG4gIHJlYWR5V29ya2VyRm9ySm9iKGpvYikge1xuICAgIGZvciAoY29uc3Qgd29ya2VyIG9mIHRoaXMucmVhZHlXb3JrZXJzKSB7XG4gICAgICBpZiAodGhpcy5fd29ya2VyQWNjZXB0c0pvYih7am9iLCB3b3JrZXJ9KSkgcmV0dXJuIHdvcmtlclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdvcmtlciBhY2NlcHRzIGpvYi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gYXJncy5qb2IgLSBKb2IgYmVpbmcgaGFuZGVkIG9mZi5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLndvcmtlciAtIFdvcmtlciBzb2NrZXQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIHdvcmtlciBhY2NlcHRzIHRoZSBqb2IgbW9kZS5cbiAgICovXG4gIF93b3JrZXJBY2NlcHRzSm9iKHtqb2IsIHdvcmtlcn0pIHtcbiAgICBpZiAoIXdvcmtlci5zdXBwb3J0c0hhbmRvZmZJZFJlcG9ydGluZykgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBjYXBhYmlsaXR5ID0gV09SS0VSX0VYRUNVVElPTl9NT0RFX0NBUEFCSUxJVElFU19CWV9NT0RFLmdldChqb2IuZXhlY3V0aW9uTW9kZSlcblxuICAgIGlmICghY2FwYWJpbGl0eSkgcmV0dXJuIGZhbHNlXG5cbiAgICByZXR1cm4gY2FwYWJpbGl0eS5hY2NlcHRzKHdvcmtlcilcbiAgfVxuXG4gIC8qKlxuICAgKiBBcm1zIGEgc2luZ2xlIGBzZXRUaW1lb3V0YCBmb3IgdGhlIHNvb25lc3QgZnV0dXJlLXNjaGVkdWxlZCBqb2Inc1xuICAgKiBgc2NoZWR1bGVkX2F0X21zYC4gUmVwbGFjZXMgdGhlIHNlY29uZCByZXNwb25zaWJpbGl0eSBvZiB0aGUgbGVnYWN5XG4gICAqIDEtc2Vjb25kIHBvbGwgKGJlY29taW5nLWVsaWdpYmxlIHNjaGVkdWxlZCBqb2JzKS4gVGhlIHRpbWVyIGlzXG4gICAqIGlkZW1wb3RlbnRseSByZS1hcm1lZCBhdCB0aGUgZW5kIG9mIGV2ZXJ5IGRyYWluLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9hcm1TY2hlZHVsZWRUaW1lcigpIHtcbiAgICBpZiAodGhpcy5fc2NoZWR1bGVkVGltZXIpIHtcbiAgICAgIHRoaXMuY2xvY2suY2xlYXJUaW1lb3V0KHRoaXMuX3NjaGVkdWxlZFRpbWVyKVxuICAgICAgdGhpcy5fc2NoZWR1bGVkVGltZXIgPSB1bmRlZmluZWRcbiAgICB9XG5cbiAgICBpZiAodGhpcy5fc3RvcHBlZCB8fCB0aGlzLmxpZmVjeWNsZVN0YXRlICE9PSBcImFjdGl2ZVwiIHx8ICF0aGlzLl9hY3RpdmVPd25lcnNoaXBSZWFkeSkgcmV0dXJuXG4gICAgaWYgKHRoaXMuZGlzcGF0Y2hTdHJhdGVneSA9PT0gXCJwb2xsaW5nXCIpIHJldHVyblxuXG4gICAgY29uc3QgbmV4dCA9IGF3YWl0IHRoaXMuc3RvcmUubmV4dFNjaGVkdWxlZEpvYigpXG4gICAgbGV0IGRlbGF5XG5cbiAgICBpZiAobmV4dCAmJiB0eXBlb2YgbmV4dC5zY2hlZHVsZWRBdE1zID09PSBcIm51bWJlclwiKSB7XG4gICAgICBkZWxheSA9IE1hdGgubWF4KDAsIE1hdGgubWluKG5leHQuc2NoZWR1bGVkQXRNcyAtIHRoaXMuY2xvY2subm93KCksIE1BWF9USU1FUl9NUykpXG4gICAgfVxuXG4gICAgLy8gYG5leHRTY2hlZHVsZWRKb2JgIG9ubHkgcmV0dXJucyBmdXR1cmUgam9icywgc28gYSBqb2IgdGhhdCBiZWNhbWVcbiAgICAvLyBlbGlnaWJsZSBhZnRlciB0aGUgZHJhaW4ncyBlbGlnaWJsZS1qb2IgcHJvYmUgaXMgaW52aXNpYmxlIHRvIGl0LiBJZiBvbmVcbiAgICAvLyBpcyBkaXNwYXRjaGFibGUgbm93LCBhcm0gYSAwLWRlbGF5IHJlLWRyYWluIHNvIGl0IGlzIGRpc3BhdGNoZWRcbiAgICAvLyBpbW1lZGlhdGVseSBpbnN0ZWFkIG9mIGJlaW5nIHN0cmFuZGVkIHVudGlsIHRoZSBuZXh0IGZ1dHVyZSB0aW1lciAob3JcbiAgICAvLyBleHRlcm5hbCBzaWduYWwpIGZpcmVzLlxuICAgIGlmIChhd2FpdCB0aGlzLm5leHRBdmFpbGFibGVKb2JGb3JSZWFkeVdvcmtlcnMoKSkgZGVsYXkgPSAwXG5cbiAgICBpZiAodHlwZW9mIGRlbGF5ICE9PSBcIm51bWJlclwiKSByZXR1cm5cblxuICAgIHRoaXMuX3NjaGVkdWxlZFRpbWVyID0gdGhpcy5jbG9jay5zZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMuX3NjaGVkdWxlZFRpbWVyID0gdW5kZWZpbmVkXG4gICAgICB2b2lkIHRoaXMuX2RyYWluKClcbiAgICB9LCBkZWxheSlcbiAgfVxuXG4gIGFzeW5jIF9zd2VlcE9ycGhhbnMoKSB7XG4gICAgdHJ5IHtcbiAgICAgIGxldCBvcnBoYW5lZEpvYnNcblxuICAgICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkKSB7XG4gICAgICAgIGNvbnN0IGNvbm5lY3RlZFdvcmtlcklkcyA9IG5ldyBTZXQoKVxuICAgICAgICBmb3IgKGNvbnN0IHdvcmtlciBvZiB0aGlzLndvcmtlcnMpIHtcbiAgICAgICAgICBpZiAod29ya2VyLndvcmtlcklkKSBjb25uZWN0ZWRXb3JrZXJJZHMuYWRkKHdvcmtlci53b3JrZXJJZClcbiAgICAgICAgfVxuICAgICAgICBmb3IgKGNvbnN0IHdvcmtlcklkIG9mIHRoaXMuZGlzY29ubmVjdGVkV29ya2Vycy5rZXlzKCkpIGNvbm5lY3RlZFdvcmtlcklkcy5hZGQod29ya2VySWQpXG5cbiAgICAgICAgY29uc3QgY3V0b2ZmID0gdGhpcy5jbG9jay5ub3coKSAtIEdFTkVSQVRJT05fT1JQSEFORURfQUZURVJfTVNcbiAgICAgICAgY29uc3QgaGFuZG9mZnMgPSAoYXdhaXQgdGhpcy5fZ2VuZXJhdGlvbk93bmVkSGFuZG9mZlNuYXBzaG90KCkpLmZpbHRlcigoaGFuZG9mZikgPT4ge1xuICAgICAgICAgIHJldHVybiBoYW5kb2ZmLmhhbmRlZE9mZkF0TXMgPD0gY3V0b2ZmICYmICFjb25uZWN0ZWRXb3JrZXJJZHMuaGFzKGhhbmRvZmYud29ya2VySWQpXG4gICAgICAgIH0pXG4gICAgICAgIG9ycGhhbmVkSm9icyA9IGhhbmRvZmZzLmxlbmd0aCA9PT0gMFxuICAgICAgICAgID8gW11cbiAgICAgICAgICA6IGF3YWl0IHRoaXMuc3RvcmUubWFya09ycGhhbmVkSGFuZG9mZnMoe2hhbmRvZmZzLCBlcnJvcjogXCJKb2Igb3JwaGFuZWQgYWZ0ZXIgaXRzIGdlbmVyYXRpb24gb3duZXIgZGlzYXBwZWFyZWRcIn0pXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBvcnBoYW5lZEpvYnMgPSBhd2FpdCB0aGlzLnN0b3JlLm1hcmtPcnBoYW5lZEpvYnMoKVxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLl9oYW5kbGVPcnBoYW5lZEpvYnMoe2pvYnM6IG9ycGhhbmVkSm9icywgd2FybmluZzogXCJNYXJrZWQgb3JwaGFuZWQgYmFja2dyb3VuZCBqb2JzXCJ9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICAgIGNvbnN0IHBheWxvYWQgPSB7Y29udGV4dDoge2dlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWQsIHN0YWdlOiBcImJhY2tncm91bmQtam9iLW9ycGhhbi1zd2VlcFwifSwgZXJyb3I6IG5vcm1hbGl6ZWRFcnJvcn1cbiAgICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiRmFpbGVkIHRvIG1hcmsgb3JwaGFuZWQgam9iczpcIiwgbm9ybWFsaXplZEVycm9yXSlcbiAgICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gICAgfVxuXG4gICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwiYWN0aXZlXCIpIGF3YWl0IHRoaXMuX3JlY29uY2lsZUFjdGl2ZUNvbmN1cnJlbmN5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBhaXJzIGR1cmFibGUgYWRtaXNzaW9uIGNvdW50ZXJzIG9uIHRoZSBhY3RpdmUgbWFpbidzIG1haW50ZW5hbmNlIGNhZGVuY2VcbiAgICogYW5kIGltbWVkaWF0ZWx5IHJldHJpZXMgZGlzcGF0Y2ggd2hlbiBjYXBhY2l0eSB3YXMgcmVjb3ZlcmVkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciByZXBhaXIgYW5kIGFueSByZXN1bHRpbmcgZHJhaW4uXG4gICAqL1xuICBhc3luYyBfcmVjb25jaWxlQWN0aXZlQ29uY3VycmVuY3koKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuc3RvcmUucmVjb25jaWxlQWN0aXZlQ29uY3VycmVuY3koKVxuXG4gICAgICBpZiAocmVzdWx0LnJlcGFpcmVkQ291bnQgPiAwKSBhd2FpdCB0aGlzLl9kcmFpbigpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKVxuICAgICAgY29uc3QgcGF5bG9hZCA9IHtjb250ZXh0OiB7Z2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZCwgc3RhZ2U6IFwiYmFja2dyb3VuZC1qb2ItY29uY3VycmVuY3ktcmVjb25jaWxpYXRpb25cIn0sIGVycm9yOiBub3JtYWxpemVkRXJyb3J9XG4gICAgICBjb25zdCBlcnJvckV2ZW50cyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpXG5cbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIkZhaWxlZCB0byByZWNvbmNpbGUgYmFja2dyb3VuZCBqb2IgYWN0aXZlLWNvbmN1cnJlbmN5IGNvdW50czpcIiwgbm9ybWFsaXplZEVycm9yXSlcbiAgICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFB1Ymxpc2hlcyB0aGUgY29tbW9uIHBvc3Qtb3JwaGFuIGxpZmVjeWNsZTogd2FrZSBxdWV1ZWQgcmV0cmllcywgZW1pdCBvbmVcbiAgICogaXNvbGF0ZWQgZXZlbnQgcGVyIGFjY2VwdGVkIHRyYW5zaXRpb24sIGFuZCBkcmFpbiBzbyByZWxlYXNlZCBjb25jdXJyZW5jeVxuICAgKiBjYW4gaW1tZWRpYXRlbHkgYWRtaXQgb3RoZXIgd29yay5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd1tdfSBhcmdzLmpvYnMgLSBBY2NlcHRlZCBvcnBoYW4gdHJhbnNpdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLndhcm5pbmcgLSBMaWZlY3ljbGUgbG9nIG1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSByZXN1bHRpbmcgZHJhaW4uXG4gICAqL1xuICBhc3luYyBfaGFuZGxlT3JwaGFuZWRKb2JzKHtqb2JzLCB3YXJuaW5nfSkge1xuICAgIGlmIChqb2JzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhpcy5fbWF5YmVTdG9wUmV0aXJlZCgpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLmxvZ2dlci53YXJuKCgpID0+IFt3YXJuaW5nLCBqb2JzLmxlbmd0aF0pXG4gICAgLy8gUmVjbGFpbWVkIG9ycGhhbnMgY2FuIGJlY29tZSBgcXVldWVkYCBhZ2FpbiDigJQgd2FrZSB0aGUgZGlzcGF0Y2hlciBmaXJzdFxuICAgIC8vIHNvIGFuIGFwcGxpY2F0aW9uIGV2ZW50IGhhbmRsZXIgdGhhdCB0aHJvd3MgYmVsb3cgY2Fubm90IHN0cmFuZCB0aGVtLlxuICAgIHRoaXMuX25vdGlmeUVucXVldWVkKClcbiAgICAvLyBFbWl0IGJlZm9yZSBhd2FpdGluZyB0aGUgZHJhaW4gc28gYSBibG9ja2VkIGRpc3BhdGNoZXIgY2Fubm90IGRlbGF5XG4gICAgLy8gYXBwbGljYXRpb24gcmVjb3ZlcnkuIElzb2xhdGUgaGFuZGxlcnMgc28gb25lIGNhbm5vdCBzdXBwcmVzcyB0aGUgcmVzdC5cbiAgICBmb3IgKGNvbnN0IGpvYiBvZiBqb2JzKSB7XG4gICAgICB0cnkge1xuICAgICAgICB0aGlzLl9lbWl0QmFja2dyb3VuZEpvYk9ycGhhbmVkKHtqb2J9KVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiQSBiYWNrZ3JvdW5kLWpvYi1vcnBoYW5lZCBldmVudCBoYW5kbGVyIHRocmV3OlwiLCBlcnJvcl0pXG4gICAgICB9XG4gICAgfVxuICAgIGF3YWl0IHRoaXMuX2RyYWluKClcbiAgICB0aGlzLl9tYXliZVN0b3BSZXRpcmVkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBEcm9wcyB3b3JrZXJzIHRoYXQgaGF2ZSBnb25lIHNpbGVudCBwYXN0IGB3b3JrZXJTdGFsZVRpbWVvdXRNc2AgKG5vXG4gICAqIGhlYXJ0YmVhdCwgcmVhZHksIG9yIHJlcG9ydCkuIEEgd2VkZ2VkIHdvcmtlciBrZWVwcyBpdHMgc29ja2V0IG9wZW4sIHNvIHRoZVxuICAgKiBgY2xvc2VgLWJhc2VkIGNsZWFudXAgbmV2ZXIgZmlyZXMgYW5kIGl0cyBpbi1mbGlnaHQgbGVhc2VzIOKAlCBhbmQgdGhlIHdob2xlXG4gICAqIHF1ZXVlIOKAlCBzdGF5IHN0dWNrIHVudGlsIGEgaHVtYW4gbm90aWNlcy4gUmVsZWFzaW5nIHRoZSBsb3N0IHdvcmtlcidzXG4gICAqIGxlYXNlcyBsZXRzIGl0cyBqb2JzIHJ1biBlbHNld2hlcmUgYW5kIHN0b3BzIGRpc3BhdGNoIHRvIGl0OyB0aGUgd29ya2VyJ3NcbiAgICogb3duIHByb2Nlc3MgbGlmZWN5Y2xlIGlzIHRoZSBzdXBlcnZpc29yJ3MgY29uY2Vybi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHN3ZWVwLlxuICAgKi9cbiAgYXN5bmMgX3N3ZWVwU3RhbGVXb3JrZXJzKCkge1xuICAgIGlmICh0aGlzLl9zdG9wcGVkKSByZXR1cm5cblxuICAgIGNvbnN0IGN1dG9mZiA9IHRoaXMuY2xvY2subm93KCkgLSB0aGlzLndvcmtlclN0YWxlVGltZW91dE1zXG4gICAgLyoqIEB0eXBlIHtKc29uU29ja2V0W119ICovXG4gICAgY29uc3Qgc3RhbGUgPSBbXVxuXG4gICAgZm9yIChjb25zdCB3b3JrZXIgb2YgdGhpcy53b3JrZXJzKSB7XG4gICAgICAvLyBPbmx5IGV2aWN0IGhlYXJ0YmVhdC1jYXBhYmxlIHdvcmtlcnMuIEEgbGVnYWN5IHdvcmtlciAoZS5nLiBvbmUgZnJvbSB0aGVcbiAgICAgIC8vIHByZXZpb3VzIHJlbGVhc2UgZHVyaW5nIGEgcm9sbGluZyBkZXBsb3kpIG5ldmVyIGhlYXJ0YmVhdHMsIHNvIGV2aWN0aW5nXG4gICAgICAvLyBpdCBvbiBzaWxlbmNlIHdvdWxkIHdyb25nbHkgcmVsZWFzZSB0aGUgbGVhc2VzIG9mIGEgam9iIGl0IGlzIHN0aWxsXG4gICAgICAvLyBydW5uaW5nLiBJdHMgZGlzY29ubmVjdCBpcyBzdGlsbCBoYW5kbGVkIGJ5IHRoZSBzb2NrZXQgYGNsb3NlYCBwYXRoLlxuICAgICAgaWYgKCF3b3JrZXIuc3VwcG9ydHNIZWFydGJlYXQpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGxhc3RTZWVuQXQgPSB0eXBlb2Ygd29ya2VyLmxhc3RTZWVuQXQgPT09IFwibnVtYmVyXCIgPyB3b3JrZXIubGFzdFNlZW5BdCA6IDBcblxuICAgICAgaWYgKGxhc3RTZWVuQXQgPD0gY3V0b2ZmKSBzdGFsZS5wdXNoKHdvcmtlcilcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHdvcmtlciBvZiBzdGFsZSkge1xuICAgICAgdGhpcy5sb2dnZXIud2FybigoKSA9PiBbXCJEcm9wcGluZyBzdGFsZSBiYWNrZ3JvdW5kIGpvYnMgd29ya2VyXCIsIHt3b3JrZXJJZDogd29ya2VyLndvcmtlcklkLCBsYXN0U2VlbkF0OiB3b3JrZXIubGFzdFNlZW5BdH1dKVxuXG4gICAgICB0cnkge1xuICAgICAgICB3b3JrZXIuY2xvc2UoKVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIEFscmVhZHkgY2xvc2luZzsgdGhlIGxlYXNlIHJlbGVhc2UgYmVsb3cgaXMgd2hhdCBtYXR0ZXJzLlxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLl9oYW5kbGVXb3JrZXJTb2NrZXRDbG9zZWQod29ya2VyKVxuICAgIH1cbiAgfVxufVxuIl19