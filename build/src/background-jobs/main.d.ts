import net from "net";
import JsonSocket from "./json-socket.js";
import BackgroundJobsScheduler from "./scheduler.js";
import Logger from "../logger.js";
import BackgroundJobsLifecycleControlServer from "./lifecycle-control-server.js";
export type WorkerExecutionModeCapability = {
    /**
     * - Execution mode.
     */
    executionMode: import("./types.js").BackgroundJobExecutionMode;
    /**
     * - Whether the worker accepts this mode.
     */
    accepts: (worker: JsonSocket) => boolean;
};
export default class BackgroundJobsMain {
    configuration: import("../configuration.js").default;
    closeDatabaseConnectionsOnStop: boolean;
    onStopped: (() => void | Promise<void>) | undefined;
    afterHandoffClaim: ((args: {
        handoff: import("./types.js").BackgroundJobHandoff;
        job: import("./types.js").BackgroundJobRow;
    }) => void | Promise<void>) | undefined;
    onWorkerReady: ((worker: JsonSocket) => void) | undefined;
    onWorkerHeartbeat: ((worker: JsonSocket) => void) | undefined;
    onWorkerDisconnected: ((workerId: string) => void) | undefined;
    onWorkerHandoffsReleased: ((workerId: string) => void) | undefined;
    onStartupHandoffsReclaimed: ((jobs: import("./types.js").BackgroundJobRow[]) => void) | undefined;
    onJobUpdated: ((args: {
        accepted: boolean;
        jobId: string;
        status: "completed" | "failed" | "rescheduled";
    }) => void) | undefined;
    clock: {
        clearTimeout: (timerId: ReturnType<typeof setTimeout> | number) => void;
        now: () => number;
        setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout> | number;
    };
    generationId: string | undefined;
    initialGenerationState: import("./types.js").BackgroundJobsGenerationInitialState;
    lifecycleSocketPath: string | undefined;
    /** @type {import("./types.js").BackgroundJobsGenerationLifecycleState} */
    lifecycleState: import("./types.js").BackgroundJobsGenerationLifecycleState;
    _activeOwnershipReady: boolean;
    /** @type {Promise<void> | undefined} */
    _activationPromise: Promise<void> | undefined;
    /** @type {Promise<void> | undefined} */
    _retirementPromise: Promise<void> | undefined;
    /** @type {Set<JsonSocket>} */
    candidateReadyWorkers: Set<JsonSocket>;
    /** @type {Map<string, {worker: JsonSocket, timer: ReturnType<typeof setTimeout> | number}>} */
    disconnectedWorkers: Map<string, {
        worker: JsonSocket;
        timer: ReturnType<typeof setTimeout> | number;
    }>;
    _lifecycleRequestLeases: number;
    _activeNonWorkerRequests: number;
    /**
     * Resolves stop observation.
     * @type {() => void}
     */
    _resolveStopped: () => void;
    _stoppedPromise: Promise<void>;
    host: string;
    port: number;
    dispatchStrategy: import("../configuration-types.js").BackgroundJobsDispatchStrategy;
    pollIntervalMs: number;
    retention: import("../configuration-types.js").ResolvedBackgroundJobsRetentionConfiguration;
    workerStaleTimeoutMs: number;
    workerLivenessSweepMs: number;
    workerReconnectGraceMs: number;
    /** @type {import("./adapter.js").default | undefined} */
    adapter: import("./adapter.js").default | undefined;
    logger: Logger;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Set<JsonSocket>} */
    workers: Set<JsonSocket>;
    /** @type {Set<JsonSocket>} */
    connections: Set<JsonSocket>;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Set<JsonSocket>} */
    readyWorkers: Set<JsonSocket>;
    /**
     * Active durable handoffs keyed by the exact worker socket that received them.
     * @type {Map<JsonSocket, Map<string, string>>} */
    workerHandoffs: Map<JsonSocket, Map<string, string>>;
    /**
     * Exact caller-generated leases whose claim outcome was ambiguous or whose
     * pre-dispatch release has not yet been acknowledged. Retained until a
     * fenced return succeeds (including an exact no-op).
     * @type {Map<string, string>} */
    pendingHandoffRecoveries: Map<string, string>;
    /**
     * Handoff-adoption queries started by worker hello messages. Shutdown must
     * wait for these before closing the configuration's database pools.
     * @type {Set<Promise<void>>} */
    inflightWorkerHandoffAdoptions: Set<Promise<void>>;
    /**
     * Worker ids whose handoffs were successfully adopted by a still-live
     * connection in this main generation.
     * @type {Set<string>}
     */
    reconnectedWorkerIds: Set<string>;
    /** @type {import("./types.js").BackgroundJobHandoffSnapshot[]} */
    startupHandoffSnapshot: import("./types.js").BackgroundJobHandoffSnapshot[];
    /** @type {Promise<void>[]} */
    _startupHandoffAdoptionsAtDeadline: Promise<void>[];
    _startupHandoffGraceElapsed: boolean;
    /**
     * Narrows the runtime value to the documented type.
     * @type {net.Server | undefined} */
    server: net.Server | undefined;
    /**
     * Narrows the runtime value to the documented type.
     * @type {ReturnType<typeof setTimeout> | undefined} */
    _pollTimer: ReturnType<typeof setTimeout> | undefined;
    /**
     * Narrows the runtime value to the documented type.
     * @type {ReturnType<typeof setTimeout> | undefined} */
    _scheduledTimer: ReturnType<typeof setTimeout> | undefined;
    /**
     * Narrows the runtime value to the documented type.
     * @type {ReturnType<typeof setTimeout> | undefined} */
    _errorRetryTimer: ReturnType<typeof setTimeout> | undefined;
    /**
     * Narrows the runtime value to the documented type.
     * @type {ReturnType<typeof setTimeout> | undefined} */
    _orphanTimer: ReturnType<typeof setTimeout> | undefined;
    /**
     * Narrows the runtime value to the documented type.
     * @type {ReturnType<typeof setInterval> | undefined} */
    _workerStaleTimer: ReturnType<typeof setInterval> | undefined;
    /** @type {ReturnType<typeof setTimeout> | number | undefined} */
    _startupHandoffReclaimTimer: ReturnType<typeof setTimeout> | number | undefined;
    /** @type {Promise<void> | undefined} */
    _startupHandoffReclaimPromise: Promise<void> | undefined;
    /**
     * Narrows the runtime value to the documented type.
     * @type {BackgroundJobsScheduler | undefined} */
    scheduler: BackgroundJobsScheduler | undefined;
    _draining: boolean;
    _redrainQueued: boolean;
    /** @type {Promise<void> | undefined} */
    _drainPromise: Promise<void> | undefined;
    _stopped: boolean;
    /** @type {Promise<void> | undefined} */
    stopPromise: Promise<void> | undefined;
    /**
     * Narrows the runtime value to the documented type.
     * @type {(() => void) | undefined} */
    _unsubscribeBeacon: (() => void) | undefined;
    /**
     * Narrows the runtime value to the documented type.
     * @type {((...args: Array<ReturnType<typeof JSON.parse>>) => void) | undefined} */
    _beaconConnectHandler: ((...args: Array<ReturnType<typeof JSON.parse>>) => void) | undefined;
    /**
     * Narrows the runtime value to the documented type.
     * @type {import("../beacon/client.js").default | import("../beacon/in-process-client.js").default | undefined} */
    _beaconClient: import("../beacon/client.js").default | import("../beacon/in-process-client.js").default | undefined;
    /** @type {BackgroundJobsLifecycleControlServer | undefined} */
    lifecycleControlServer: BackgroundJobsLifecycleControlServer | undefined;
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
    constructor({ configuration, host, port, generationId: explicitGenerationId, initialGenerationState: explicitInitialGenerationState, lifecycleSocketPath: explicitLifecycleSocketPath, workerStaleTimeoutMs, workerLivenessSweepMs, workerReconnectGraceMs, closeDatabaseConnectionsOnStop, onStopped, afterHandoffClaim, onWorkerReady, onWorkerHeartbeat, onWorkerDisconnected, onWorkerHandoffsReleased, onStartupHandoffsReclaimed, onJobUpdated, clock }: {
        configuration: import("../configuration.js").default;
        host?: string;
        port?: number;
        generationId?: string;
        initialGenerationState?: import("./types.js").BackgroundJobsGenerationInitialState;
        lifecycleSocketPath?: string;
        workerStaleTimeoutMs?: number;
        workerLivenessSweepMs?: number;
        workerReconnectGraceMs?: number;
        closeDatabaseConnectionsOnStop?: boolean;
        onStopped?: () => void | Promise<void>;
        afterHandoffClaim?: (args: {
            handoff: import("./types.js").BackgroundJobHandoff;
            job: import("./types.js").BackgroundJobRow;
        }) => void | Promise<void>;
        onWorkerReady?: (worker: JsonSocket) => void;
        onWorkerHeartbeat?: (worker: JsonSocket) => void;
        onWorkerDisconnected?: (workerId: string) => void;
        onWorkerHandoffsReleased?: (workerId: string) => void;
        onStartupHandoffsReclaimed?: (jobs: import("./types.js").BackgroundJobRow[]) => void;
        onJobUpdated?: (args: {
            accepted: boolean;
            jobId: string;
            status: "completed" | "failed" | "rescheduled";
        }) => void;
        clock?: {
            now: () => number;
            setTimeout?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout> | number;
            clearTimeout?: (timerId: ReturnType<typeof setTimeout> | number) => void;
        };
    });
    /**
     * Compatibility alias for integrations that inspect the active main store.
     * @returns {import("./adapter.js").default} - Adapter acquired by start.
     */
    get store(): import("./adapter.js").default;
    /**
     * Preserves the historical subclass seam while keeping one adapter reference.
     * @param {import("./adapter.js").default} adapter - Adapter to assign.
     */
    set store(adapter: import("./adapter.js").default);
    /**
     * Runs start.
     * @returns {Promise<void>} - Resolves when listening.
     */
    start(): Promise<void>;
    /**
     * Runs stop.
     * @returns {Promise<void>} - Resolves when closed.
     */
    stop(): Promise<void>;
    /**
     * Runs the main-process shutdown lifecycle once.
     * @returns {Promise<void>} - Resolves when closed.
     */
    _stop(): Promise<void>;
    /**
     * Runs close workers.
     * @returns {void} */
    _closeWorkers(): void;
    /**
     * Runs clear timers.
     * @returns {void} */
    _clearTimers(): void;
    /**
     * Runs disconnect beacon handlers.
     * @returns {void} */
    _disconnectBeaconHandlers(): void;
    /**
     * Runs stop beacon and server.
     * @returns {Promise<void>} */
    _stopBeaconAndServer(): Promise<void>;
    /**
     * Runs close server.
     * @returns {Promise<void>} */
    _closeServer(): Promise<void>;
    /**
     * Runs get port.
     * @returns {number} - Bound port.
     */
    getPort(): number;
    /**
     * Gets the lifecycle state.
     * @returns {import("./types.js").BackgroundJobsGenerationLifecycleState} - Current lifecycle state.
     */
    getLifecycleState(): import("./types.js").BackgroundJobsGenerationLifecycleState;
    /**
     * Returns a promise that settles only after the main has fully stopped.
     * @returns {Promise<void>} - Stop completion.
     */
    waitUntilStopped(): Promise<void>;
    /**
     * Snapshots only exact durable owners from this release generation.
     * Legacy mode intentionally retains its historical global snapshot.
     * @returns {Promise<import("./types.js").BackgroundJobHandoffSnapshot[]>} - Owned snapshot.
     */
    _generationOwnedHandoffSnapshot(): Promise<import("./types.js").BackgroundJobHandoffSnapshot[]>;
    /**
     * Acquires scheduling and dispatch ownership for an active generation.
     * @returns {Promise<void>} - Resolves after active ownership is established.
     */
    _startActiveOwnership(): Promise<void>;
    /** Starts exact recovery duties without acquiring global dispatch ownership. */
    _startGenerationRecoveryOwnership(): void;
    /** Starts the generation-fenced orphan sweep. */
    _startOrphanSweep(): void;
    /**
     * Starts schedule ownership exactly once.
     * @returns {Promise<void>} - Resolves after schedules are loaded.
     */
    _startScheduler(): Promise<void>;
    /** Credits readiness advertisements recorded while dispatch was fenced. */
    _creditReadyWorkers(): void;
    /**
     * Activates a candidate after its supervisor has retired the old generation.
     * @returns {Promise<void>} - Resolves after scheduling and dispatch are active.
     */
    activate(): Promise<void>;
    /**
     * Runs activation.
     * @returns {Promise<void>} - Activation completion.
     */
    _activate(): Promise<void>;
    /**
     * Establishes the synchronous retirement fence and then drains ownership setup.
     * @returns {Promise<void>} - Resolves after the retirement fence is durable in memory.
     */
    retire(): Promise<void>;
    /**
     * Runs retirement after its synchronous fence.
     * @returns {Promise<void>} - Retirement fence completion.
     */
    _retire(): Promise<void>;
    /** Clears timers that can initiate new global dispatch or schedule work. */
    _clearDispatchTimers(): void;
    /** Holds the main open until a lifecycle response has flushed. */
    acquireLifecycleRequestLease(): void;
    /** Releases one lifecycle-response lease after its socket write callback. */
    releaseLifecycleRequestLease(): void;
    /** Stops a retired generation only after its exact ownership has drained. */
    _maybeStopRetired(): void;
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
    _setupDispatchTriggers(): void;
    /**
     * Arms the bounded adoption grace only when startup found exact persisted
     * handoffs. The timer is unrefed so an otherwise-finished process is never
     * retained solely to perform this cleanup.
     * @returns {void}
     */
    _setupStartupHandoffReclaim(): void;
    /**
     * Starts one tracked startup-reclaim pass, coalescing lifecycle and retry
     * callers so shutdown can wait for durable mutation before closing pools.
     * @returns {Promise<void>} - Resolves after this pass settles.
     */
    _startStartupHandoffReclaim(): Promise<void>;
    /**
     * Waits for an already-started startup reclaim before adapter shutdown.
     * @returns {Promise<void>} - Resolves when no pass remains.
     */
    _drainStartupHandoffReclaim(): Promise<void>;
    /**
     * Orphans only startup-snapshotted leases whose stable worker id has not been
     * observed by this main generation. Store fencing rejects completed,
     * returned, replaced, and re-handed-off rows.
     * @returns {Promise<void>} - Resolves after reclaim or retained retry state.
     */
    _reclaimDisconnectedStartupHandoffs(): Promise<void>;
    /**
     * Lets adoption queries already running at the reconnect deadline settle
     * before worker ids are filtered. A second bounded grace prevents a stuck
     * adapter query from deferring startup reclaim forever.
     * @returns {Promise<void>} - Resolves when the deadline set settles or times out.
     */
    _waitForStartupHandoffAdoptionsAtDeadline(): Promise<void>;
    /**
     * Publishes a dispatch wake-up on the Beacon channel. No-op in polling
     * mode or when Beacon is not connected; in those cases the direct
     * in-process `_drain()` call in the enqueue/handle paths is sufficient
     * (there are no other processes to notify).
     * @returns {void}
     */
    _notifyEnqueued(): void;
    /**
     * Runs handle connection.
     * @param {import("net").Socket} socket - Socket.
     * @returns {void}
     */
    _handleConnection(socket: import("net").Socket): void;
    /**
     * Surfaces an unexpected protocol-handler failure.
     * @param {ReturnType<typeof JSON.parse>} error - Handler failure.
     * @returns {void}
     */
    _reportConnectionHandlerError(error: ReturnType<typeof JSON.parse>): void;
    /**
     * Runs handle socket message.
     * @param {object} args - Options.
     * @param {JsonSocket} args.jsonSocket - JSON socket.
     * @param {import("./types.js").BackgroundJobSocketMessage} args.message - Socket message.
     * @param {import("./types.js").BackgroundJobSocketRole | null} args.role - Current socket role.
     * @returns {Promise<import("./types.js").BackgroundJobSocketRole | null>} - Updated socket role.
     */
    _handleSocketMessage({ jsonSocket, message, role }: {
        jsonSocket: JsonSocket;
        message: import("./types.js").BackgroundJobSocketMessage;
        role: import("./types.js").BackgroundJobSocketRole | null;
    }): Promise<import("./types.js").BackgroundJobSocketRole | null>;
    /**
     * Runs handle roleless socket message.
     * @param {object} args - Options.
     * @param {JsonSocket} args.jsonSocket - JSON socket.
     * @param {import("./types.js").BackgroundJobSocketMessage} args.message - Socket message.
     * @returns {Promise<import("./types.js").BackgroundJobSocketRole | null>} - New socket role.
     */
    _handleRolelessSocketMessage({ jsonSocket, message }: {
        jsonSocket: JsonSocket;
        message: import("./types.js").BackgroundJobSocketMessage;
    }): Promise<import("./types.js").BackgroundJobSocketRole | null>;
    /**
     * Validates the generation fence before assigning a socket role.
     * @param {import("./types.js").BackgroundJobHelloMessage} message - Hello message.
     * @returns {import("./types.js").BackgroundJobsGenerationRejectionReason | null} - Rejection reason.
     */
    _generationHelloRejectionReason(message: import("./types.js").BackgroundJobHelloMessage): import("./types.js").BackgroundJobsGenerationRejectionReason | null;
    /**
     * Registers a generation-fenced worker and transfers only its exact ownership.
     * @param {object} args - Worker hello.
     * @param {JsonSocket} args.jsonSocket - New socket.
     * @param {import("./types.js").BackgroundJobHelloMessage} args.message - Hello.
     * @returns {Promise<boolean>} - Whether the worker was admitted.
     */
    _registerWorker({ jsonSocket, message }: {
        jsonSocket: JsonSocket;
        message: import("./types.js").BackgroundJobHelloMessage;
    }): Promise<boolean>;
    /**
     * Tracks a worker handoff-adoption query through shutdown.
     * @param {JsonSocket} jsonSocket - Reconnecting worker socket.
     * @returns {void}
     */
    _trackWorkerHandoffAdoption(jsonSocket: JsonSocket): void;
    /**
     * Waits for worker handoff-adoption queries to finish.
     * @returns {Promise<void>} - Resolves when no adoption query remains.
     */
    _drainWorkerHandoffAdoptions(): Promise<void>;
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
    _adoptWorkerHandoffs(jsonSocket: JsonSocket): Promise<void>;
    /**
     * Runs handle client socket message.
     * @param {object} args - Options.
     * @param {JsonSocket} args.jsonSocket - JSON socket.
     * @param {import("./types.js").BackgroundJobSocketMessage} args.message - Socket message.
     * @returns {Promise<void>} - Resolves after the request is acknowledged.
     */
    _handleClientSocketMessage({ jsonSocket, message }: {
        jsonSocket: JsonSocket;
        message: import("./types.js").BackgroundJobSocketMessage;
    }): Promise<void>;
    /**
     * Runs handle worker socket message.
     * @param {object} args - Options.
     * @param {JsonSocket} args.jsonSocket - JSON socket.
     * @param {import("./types.js").BackgroundJobSocketMessage} args.message - Socket message.
     * @returns {Promise<void>} - Resolves after the worker message is handled.
     */
    _handleWorkerSocketMessage({ jsonSocket, message }: {
        jsonSocket: JsonSocket;
        message: import("./types.js").BackgroundJobSocketMessage;
    }): Promise<void>;
    /**
     * Runs handle reporter socket message.
     * @param {object} args - Options.
     * @param {JsonSocket} args.jsonSocket - JSON socket.
     * @param {import("./types.js").BackgroundJobSocketMessage} args.message - Socket message.
     * @returns {Promise<void>} - Resolves after the report is acknowledged.
     */
    _handleReporterSocketMessage({ jsonSocket, message }: {
        jsonSocket: JsonSocket;
        message: import("./types.js").BackgroundJobSocketMessage;
    }): Promise<void>;
    /**
     * Requires the complete durable lease identity before a generation-mode
     * reporter can mutate a job. Legacy reporters keep their permissive protocol.
     * @param {import("./types.js").BackgroundJobSocketMessage} message - Reporter message.
     * @returns {boolean} - Whether the report lacks its exact generation lease.
     */
    _generationReportIsInvalid(message: import("./types.js").BackgroundJobSocketMessage): boolean;
    /**
     * Runs handle worker ready.
     * @param {object} args - Options.
     * @param {JsonSocket} args.jsonSocket - JSON socket.
     * @param {import("./types.js").BackgroundJobReadyMessage} args.message - Ready message.
     * @returns {void}
     */
    _handleWorkerReady({ jsonSocket, message }: {
        jsonSocket: JsonSocket;
        message: import("./types.js").BackgroundJobReadyMessage;
    }): void;
    /**
     * Runs handle worker draining.
     * @param {object} args - Options.
     * @param {JsonSocket} args.jsonSocket - JSON socket.
     * @returns {void}
     */
    _handleWorkerDraining({ jsonSocket }: {
        jsonSocket: JsonSocket;
    }): void;
    /**
     * Removes a lost worker socket and releases only leases dispatched through it.
     * @param {JsonSocket} worker - Disconnected worker socket.
     * @param {object} [args] - Coordination options.
     * @param {boolean} [args.queueRedrain] - Queue another pass instead of awaiting the active drain.
     * @returns {Promise<void>} - Resolves after its active leases are released.
     */
    _handleWorkerSocketClosed(worker: JsonSocket, { queueRedrain }?: {
        queueRedrain?: boolean;
    }): Promise<void>;
    /**
     * Releases all leases still owned by one exact worker socket.
     * @param {JsonSocket} worker - Worker socket.
     * @param {object} [args] - Coordination options.
     * @param {boolean} [args.queueRedrain] - Queue another pass instead of awaiting the active drain.
     * @returns {Promise<void>} - Resolves after fenced releases and dispatch wake-up.
     */
    _releaseWorkerHandoffs(worker: JsonSocket, { queueRedrain }?: {
        queueRedrain?: boolean;
    }): Promise<void>;
    /**
     * Runs one idempotent conditional lease release.
     * @param {object} args - Options.
     * @param {string} args.handoffId - Handoff lease id.
     * @param {string} args.jobId - Job id.
     * @param {JsonSocket} args.worker - Socket that received the lease.
     * @returns {Promise<void>} - Resolves after the fenced transition.
     */
    _releaseHandoff({ handoffId, jobId, worker }: {
        handoffId: string;
        jobId: string;
        worker: JsonSocket;
    }): Promise<void>;
    /**
     * Forgets a successfully reported lease without relying on worker ids.
     * @param {object} args - Options.
     * @param {string} args.handoffId - Handoff lease id.
     * @param {string} args.jobId - Job id.
     * @returns {void}
     */
    _forgetHandoff({ handoffId, jobId }: {
        handoffId: string;
        jobId: string;
    }): void;
    /**
     * Reports an unexpected lease-release failure on framework error channels.
     * @param {ReturnType<typeof JSON.parse>} error - Release failure.
     * @returns {void}
     */
    _reportHandoffReleaseError(error: ReturnType<typeof JSON.parse>): void;
    /**
     * Reports an unexpected worker-handoff adoption failure on framework error
     * channels. A failed adoption is not fatal (the worker's jobs remain and are
     * reclaimed by the orphan sweep), but must surface rather than be swallowed.
     * @param {ReturnType<typeof JSON.parse>} error - Adoption failure.
     * @returns {void}
     */
    _reportHandoffAdoptError(error: ReturnType<typeof JSON.parse>): void;
    /**
     * Reports an unexpected startup-snapshot reclaim failure while retaining the
     * snapshot for the dispatcher's existing transient-error retry lifecycle.
     * @param {ReturnType<typeof JSON.parse>} error - Reclaim failure.
     * @returns {void}
     */
    _reportStartupHandoffReclaimError(error: ReturnType<typeof JSON.parse>): void;
    /**
     * Runs handle enqueue.
     * @param {object} args - Options.
     * @param {JsonSocket} args.jsonSocket - JSON socket.
     * @param {import("./types.js").BackgroundJobEnqueueMessage} args.message - Message.
     * @returns {Promise<void>} - Resolves when handled.
     */
    _handleEnqueue({ jsonSocket, message }: {
        jsonSocket: JsonSocket;
        message: import("./types.js").BackgroundJobEnqueueMessage;
    }): Promise<void>;
    /**
     * Handles a stable-key replacement request and re-arms dispatch afterward.
     * @param {object} args - Options.
     * @param {JsonSocket} args.jsonSocket - JSON socket.
     * @param {import("./types.js").BackgroundJobReplaceScheduledMessage} args.message - Message.
     * @returns {Promise<void>} - Resolves when handled.
     */
    _handleReplaceScheduled({ jsonSocket, message }: {
        jsonSocket: JsonSocket;
        message: import("./types.js").BackgroundJobReplaceScheduledMessage;
    }): Promise<void>;
    /**
     * Handles a stable-key cancellation request and re-arms dispatch afterward.
     * @param {object} args - Options.
     * @param {JsonSocket} args.jsonSocket - JSON socket.
     * @param {import("./types.js").BackgroundJobCancelScheduledMessage} args.message - Message.
     * @returns {Promise<void>} - Resolves when handled.
     */
    _handleCancelScheduled({ jsonSocket, message }: {
        jsonSocket: JsonSocket;
        message: import("./types.js").BackgroundJobCancelScheduledMessage;
    }): Promise<void>;
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
    _handleClientMutationError({ context, error, fallbackMessage, jsonSocket, logMessage, responseType }: {
        context: Record<string, ReturnType<typeof JSON.parse>>;
        error: ReturnType<typeof JSON.parse>;
        fallbackMessage: string;
        jsonSocket: JsonSocket;
        logMessage: string;
        responseType: "enqueue-error" | "replace-scheduled-error" | "cancel-scheduled-error";
    }): void;
    /**
     * Runs handle job complete.
     * @param {object} args - Options.
     * @param {JsonSocket} args.jsonSocket - JSON socket.
     * @param {import("./types.js").BackgroundJobCompleteMessage} args.message - Message.
     * @returns {Promise<void>} - Resolves when handled.
     */
    _handleJobComplete({ jsonSocket, message }: {
        jsonSocket: JsonSocket;
        message: import("./types.js").BackgroundJobCompleteMessage;
    }): Promise<void>;
    /**
     * Surfaces an unexpected durable report failure without exposing it to the
     * reporting peer.
     * @param {object} args - Failure context.
     * @param {ReturnType<typeof JSON.parse>} args.error - Adapter failure.
     * @param {string} args.jobId - Durable job id.
     * @param {string} args.stage - Mutation stage.
     */
    _reportJobUpdateFailure({ error, jobId, stage }: {
        error: ReturnType<typeof JSON.parse>;
        jobId: string;
        stage: string;
    }): void;
    /**
     * Persists a normal job reschedule outcome and wakes scheduled dispatch.
     * @param {object} args - Options.
     * @param {JsonSocket} args.jsonSocket - JSON socket.
     * @param {import("./types.js").BackgroundJobRescheduleMessage} args.message - Message.
     * @returns {Promise<void>} - Resolves when handled.
     */
    _handleJobReschedule({ jsonSocket, message }: {
        jsonSocket: JsonSocket;
        message: import("./types.js").BackgroundJobRescheduleMessage;
    }): Promise<void>;
    /**
     * Runs handle job failed.
     * @param {object} args - Options.
     * @param {JsonSocket} args.jsonSocket - JSON socket.
     * @param {import("./types.js").BackgroundJobFailedMessage} args.message - Message.
     * @returns {Promise<void>} - Resolves when handled.
     */
    _handleJobFailed({ jsonSocket, message }: {
        jsonSocket: JsonSocket;
        message: import("./types.js").BackgroundJobFailedMessage;
    }): Promise<void>;
    /**
     * Runs emit background job failed.
     * @param {{error: ReturnType<typeof JSON.parse>, handoffId?: string, handedOffAtMs?: number, job: import("./types.js").BackgroundJobRow, workerId?: string}} args - Failure event data.
     * @returns {void}
     */
    _emitBackgroundJobFailed({ error, handoffId, handedOffAtMs, job, workerId }: {
        error: ReturnType<typeof JSON.parse>;
        handoffId?: string;
        handedOffAtMs?: number;
        job: import("./types.js").BackgroundJobRow;
        workerId?: string;
    }): void;
    /**
     * Emits `background-job-orphaned` (mirrored to `all-error`) for a job the time-based orphan sweep
     * reclaimed after its worker died mid-run. Unlike `background-job-failed`, which fires on a
     * worker's failure report, this fires from the main process's sweep, so applications can react to
     * a dead worker's specific job — recover the work it left behind — without polling. `willRetry`
     * reflects whether the reclaim returned the job to the queue for another attempt.
     * @param {{job: import("./types.js").BackgroundJobRow}} args - The orphaned job.
     * @returns {void}
     */
    _emitBackgroundJobOrphaned({ job }: {
        job: import("./types.js").BackgroundJobRow;
    }): void;
    /**
     * Runs normalize failure error.
     * @param {ReturnType<typeof JSON.parse>} error - Reported failure value.
     * @returns {Error} Normalized error.
     */
    _normalizeFailureError(error: ReturnType<typeof JSON.parse>): Error;
    /**
     * Runs error from unknown failure.
     * @param {ReturnType<typeof JSON.parse>} error - Reported failure value.
     * @returns {Error} Normalized error.
     */
    _errorFromUnknownFailure(error: ReturnType<typeof JSON.parse>): Error;
    /**
     * Runs message from unknown failure.
     * @param {ReturnType<typeof JSON.parse>} error - Reported failure value.
     * @returns {string} Error message.
     */
    _messageFromUnknownFailure(error: ReturnType<typeof JSON.parse>): string;
    /**
     * Runs has string failure.
     * @param {ReturnType<typeof JSON.parse>} error - Reported failure value.
     * @returns {error is string} Whether the value is a non-empty string.
     */
    _hasStringFailure(error: ReturnType<typeof JSON.parse>): error is string;
    /**
     * Runs copy string failure stack.
     * @param {object} args - Options.
     * @param {ReturnType<typeof JSON.parse>} args.error - Reported failure value.
     * @param {Error} args.normalizedError - Normalized error.
     * @returns {void}
     */
    _copyStringFailureStack({ error, normalizedError }: {
        error: ReturnType<typeof JSON.parse>;
        normalizedError: Error;
    }): void;
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
    _drain(): Promise<void>;
    /**
     * Runs one serialized drain lifecycle, including timer re-arming.
     * @returns {Promise<void>} - Resolves after every coalesced request is handled.
     */
    _drainToCompletion(): Promise<void>;
    /**
     * Runs finish drain.
     * @param {object} args - Options.
     * @param {boolean} args.errored - Whether the drain hit an error.
     * @returns {Promise<void>} - Resolves after follow-up timers are handled.
     */
    _finishDrain({ errored }: {
        errored: boolean;
    }): Promise<void>;
    /**
     * Runs arm scheduled timer or retry.
     * @returns {Promise<void>} - Resolves after scheduled timer handling.
     */
    _armScheduledTimerOrRetry(): Promise<void>;
    /**
     * Runs clear error retry timer.
     * @returns {void} */
    _clearErrorRetryTimer(): void;
    /**
     * Runs drain until idle.
     * @returns {Promise<boolean>} - Whether the drain hit an error.
     */
    _drainUntilIdle(): Promise<boolean>;
    /**
     * Runs run drain loop.
     * @returns {Promise<boolean>} - Whether the drain hit an error.
     */
    _runDrainLoop(): Promise<boolean>;
    /**
     * Runs drain once with error report.
     * @returns {Promise<boolean>} - Whether one drain pass failed.
     */
    _drainOnceWithErrorReport(): Promise<boolean>;
    /**
     * Arms a one-shot `setTimeout` to retry `_drain` after a transient
     * failure. Idempotent — repeated calls while a retry is already
     * pending are no-ops. Polling mode already retries via its own
     * interval, so this is a no-op in that mode.
     * @returns {void}
     */
    _scheduleErrorRetry(): void;
    /**
     * Retries failed pre-dispatch and disconnected-socket releases before
     * draining queued work.
     * @returns {Promise<void>} - Resolves after retry work.
     */
    _retryAfterError(): Promise<void>;
    /**
     * Inner drain loop: pulls eligible queued jobs and hands them off to
     * ready workers until one of them runs out.
     * @returns {Promise<void>}
     */
    _drainOnce(): Promise<void>;
    /**
     * Consumes one advertised worker admission while persistence is in flight.
     * @param {object} args - Admission details.
     * @param {import("./types.js").BackgroundJobRow} args.job - Selected job.
     * @param {JsonSocket} args.worker - Selected worker socket.
     * @returns {{pooledCreditConsumed: boolean, readinessVersion: number}} - Reversible admission debit.
     */
    _consumeWorkerAdmission({ job, worker }: {
        job: import("./types.js").BackgroundJobRow;
        worker: JsonSocket;
    }): {
        pooledCreditConsumed: boolean;
        readinessVersion: number;
    };
    /**
     * Restores an admission that never reached a worker. A newer readiness
     * advertisement is already authoritative, so its pooled count is not changed.
     * @param {object} args - Admission details.
     * @param {boolean} args.pooledCreditConsumed - Whether a pooled credit was debited.
     * @param {number} args.readinessVersion - Readiness generation at debit time.
     * @param {JsonSocket} args.worker - Selected worker socket.
     * @returns {void}
     */
    _restoreWorkerAdmission({ pooledCreditConsumed, readinessVersion, worker }: {
        pooledCreditConsumed: boolean;
        readinessVersion: number;
        worker: JsonSocket;
    }): void;
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
    _finalizeWorkerAdmission({ job, pooledCreditConsumed, readinessVersion, worker }: {
        job: import("./types.js").BackgroundJobRow;
        pooledCreditConsumed: boolean;
        readinessVersion: number;
        worker: JsonSocket;
    }): void;
    /**
     * Retains an exact lease for idempotent pre-dispatch recovery.
     * @param {{handoffId: string, jobId: string}} args - Exact recovery fence.
     * @returns {void}
     */
    _rememberHandoffRecovery({ handoffId, jobId }: {
        handoffId: string;
        jobId: string;
    }): void;
    /**
     * Returns one exact lease and forgets it only after the adapter acknowledges
     * the fenced transition or confirms it was already absent.
     * @param {{handoffId: string, jobId: string}} args - Exact recovery fence.
     * @returns {Promise<void>} - Resolves after durable recovery settles.
     */
    _recoverHandoff({ handoffId, jobId }: {
        handoffId: string;
        jobId: string;
    }): Promise<void>;
    /**
     * Replays retained exact-ID recoveries through the dispatcher's existing
     * transient-error retry lifecycle.
     * @returns {Promise<void>} - Resolves after every retained recovery settles.
     */
    _retryPendingHandoffRecoveries(): Promise<void>;
    /**
     * Surfaces a failed exact-ID recovery without dropping its retry ledger entry.
     * @param {object} args - Recovery failure.
     * @param {ReturnType<typeof JSON.parse>} args.error - Adapter failure.
     * @param {string} args.handoffId - Exact lease fence.
     * @param {string} args.jobId - Job id.
     * @returns {void}
     */
    _reportHandoffRecoveryError({ error, handoffId, jobId }: {
        error: ReturnType<typeof JSON.parse>;
        handoffId: string;
        jobId: string;
    }): void;
    /**
     * Runs next available job for ready workers.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Next queued job matching ready worker capacity.
     */
    nextAvailableJobForReadyWorkers(): Promise<import("./types.js").BackgroundJobRow | null>;
    /**
     * Runs ready worker execution modes.
     * @returns {import("./types.js").BackgroundJobExecutionMode[]} - Execution modes currently accepted by ready workers.
     */
    readyWorkerExecutionModes(): import("./types.js").BackgroundJobExecutionMode[];
    /**
     * Runs add accepted execution modes.
     * @param {object} args - Options.
     * @param {Set<import("./types.js").BackgroundJobExecutionMode>} args.executionModes - Accepted modes.
     * @param {JsonSocket} args.worker - Worker socket.
     * @returns {void}
     */
    _addAcceptedExecutionModes({ executionModes, worker }: {
        executionModes: Set<import("./types.js").BackgroundJobExecutionMode>;
        worker: JsonSocket;
    }): void;
    /**
     * Runs ready worker for job.
     * @param {import("./types.js").BackgroundJobRow} job - Job being handed off.
     * @returns {JsonSocket | undefined} - Ready worker for the job type.
     */
    readyWorkerForJob(job: import("./types.js").BackgroundJobRow): JsonSocket | undefined;
    /**
     * Runs worker accepts job.
     * @param {object} args - Options.
     * @param {import("./types.js").BackgroundJobRow} args.job - Job being handed off.
     * @param {JsonSocket} args.worker - Worker socket.
     * @returns {boolean} - Whether the worker accepts the job mode.
     */
    _workerAcceptsJob({ job, worker }: {
        job: import("./types.js").BackgroundJobRow;
        worker: JsonSocket;
    }): boolean;
    /**
     * Arms a single `setTimeout` for the soonest future-scheduled job's
     * `scheduled_at_ms`. Replaces the second responsibility of the legacy
     * 1-second poll (becoming-eligible scheduled jobs). The timer is
     * idempotently re-armed at the end of every drain.
     * @returns {Promise<void>}
     */
    _armScheduledTimer(): Promise<void>;
    _sweepOrphans(): Promise<void>;
    /**
     * Publishes the common post-orphan lifecycle: wake queued retries, emit one
     * isolated event per accepted transition, and drain so released concurrency
     * can immediately admit other work.
     * @param {object} args - Options.
     * @param {import("./types.js").BackgroundJobRow[]} args.jobs - Accepted orphan transitions.
     * @param {string} args.warning - Lifecycle log message.
     * @returns {Promise<void>} - Resolves after the resulting drain.
     */
    _handleOrphanedJobs({ jobs, warning }: {
        jobs: import("./types.js").BackgroundJobRow[];
        warning: string;
    }): Promise<void>;
    /**
     * Drops workers that have gone silent past `workerStaleTimeoutMs` (no
     * heartbeat, ready, or report). A wedged worker keeps its socket open, so the
     * `close`-based cleanup never fires and its in-flight leases — and the whole
     * queue — stay stuck until a human notices. Releasing the lost worker's
     * leases lets its jobs run elsewhere and stops dispatch to it; the worker's
     * own process lifecycle is the supervisor's concern.
     * @returns {Promise<void>} - Resolves after the sweep.
     */
    _sweepStaleWorkers(): Promise<void>;
}
//# sourceMappingURL=main.d.ts.map