import JsonSocket from "./json-socket.js";
import BackgroundJobsStatusReporter from "./status-reporter.js";
export type ForkedJobTimeoutState = {
    /**
     * - Whether the timeout fired and the child was terminated.
     */
    timedOut: boolean;
    /**
     * - The armed timeout in ms, or null when disabled.
     */
    timeoutMs: number | null;
    /**
     * - The pending timeout timer, cleared on exit.
     */
    timer: ReturnType<typeof setTimeout> | null;
    /**
     * - The pending SIGKILL grace timer, cleared on exit.
     */
    sigkillTimer: ReturnType<typeof setTimeout> | null;
};
export type PooledJobEntry = {
    /**
     * - Durable job payload.
     */
    payload: import("./types.js").BackgroundJobPayload & {
        id: string;
    };
    /**
     * - Completion resolver.
     */
    resolve?: (value: void) => void;
    /**
     * - Tracked pooled-job promise.
     */
    pooledJob?: Promise<void>;
    /**
     * - Per-job timeout timer.
     */
    timeoutTimer?: ReturnType<typeof setTimeout> | null;
};
export type PooledChildState = {
    /**
     * - Child creation timestamp.
     */
    createdAtMs: number;
    /**
     * - Acknowledged jobs completed by this child.
     */
    jobsRun: number;
    /**
     * - Jobs currently owned by this child.
     */
    inflight: Map<string, PooledJobEntry>;
    /**
     * - Round-robin dispatch sequence.
     */
    lastDispatchSeq: number;
    /**
     * - Whether this child is draining before retirement.
     */
    retiring: boolean;
    /**
     * - Whether the child completed its startup handshake.
     */
    started?: boolean;
    /**
     * - Whether failure handling already owns this child.
     */
    settling?: boolean;
    /**
     * - Pending timeout SIGKILL timer.
     */
    timeoutSigkillTimer?: ReturnType<typeof setTimeout> | null;
    /**
     * - Expected termination reason.
     */
    terminationReason?: import("./types.js").PooledRunnerTerminationReason;
    /**
     * - Job whose timeout initiated termination.
     */
    timeoutJobId?: string;
};
export default class BackgroundJobsWorker {
    /**
     * Narrows the runtime value to the documented type.
     * @type {Promise<import("../configuration.js").default>} */
    configurationPromise: Promise<import("../configuration.js").default>;
    /**
     * Narrows the runtime value to the documented type.
     * @type {import("../configuration.js").default | undefined} */
    configuration: import("../configuration.js").default | undefined;
    host: string | undefined;
    port: number | undefined;
    explicitGenerationId: string | undefined;
    workerInstanceId: string;
    /** @type {string | undefined} */
    generationId: string | undefined;
    closeDatabaseConnectionsOnStop: boolean;
    onStopped: (() => void | Promise<void>) | undefined;
    onGenerationAccepted: (() => void) | undefined;
    onRetireMessage: (() => void) | undefined;
    /**
     * Constructor override for the inline-job concurrency cap. When unset
     * the cap is read from `configuration.getBackgroundJobsConfig()` in
     * `start()` (default: 4).
     * @type {number | undefined}
     */
    maxConcurrentInlineJobsOverride: number | undefined;
    /**
     * Narrows the runtime value to the documented type.
     * @type {number | undefined} */
    maxConcurrentForkedJobsOverride: number | undefined;
    /**
     * Resolved cap for inline-job concurrency. Set in `start()`; defaults to
     * 4 if no configuration value is available.
     * @type {number}
     */
    maxConcurrentInlineJobs: number;
    /**
     * Narrows the runtime value to the documented type.
     * @type {number} */
    maxConcurrentForkedJobs: number;
    pooledRunnerCountOverride: number | undefined;
    pooledRunnerConcurrencyOverride: number | undefined;
    pooledRunnerMaxJobsOverride: number | undefined;
    pooledRunnerMaxRssBytesOverride: number | undefined;
    pooledRunnerMaxLifetimeMsOverride: number | undefined;
    pooledRunnerCount: number;
    pooledRunnerConcurrency: number;
    pooledRunnerMaxJobs: number;
    pooledRunnerMaxRssBytes: number;
    pooledRunnerMaxLifetimeMs: number;
    /**
     * Grace period between SIGTERM and SIGKILL when reaping process runners that
     * outlast a bounded shutdown drain.
     * @type {number}
     */
    forkedChildSigkillGraceMs: number;
    /**
     * Constructor override for the forked and pooled wall-clock job timeout. When unset the
     * timeout is read from `configuration.getBackgroundJobsConfig().jobTimeoutMs`
     * at fork time (default: disabled).
     * @type {number | undefined}
     */
    jobTimeoutMsOverride: number | undefined;
    shouldStop: boolean;
    isRetiring: boolean;
    /** @type {Promise<void> | undefined} */
    stopPromise: Promise<void> | undefined;
    /**
     * Resolves stop observation.
     * @type {(value?: void) => void}
     */
    _resolveStopped: (value?: void) => void;
    /**
     * Rejects stop observation.
     * @type {(error: Error) => void}
     */
    _rejectStopped: (error: Error) => void;
    /** @type {Promise<void>} */
    _stoppedPromise: Promise<void>;
    workerId: string;
    _generationAccepted: boolean;
    generationHandshakeTimeoutMs: number;
    reconnectDelayMs: number;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    _reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    heartbeatIntervalMs: number;
    /**
     * Narrows the runtime value to the documented type.
     * @type {ReturnType<typeof setInterval> | undefined} */
    _heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    /**
     * In-flight job-result reports to the main. Reporting is decoupled from the
     * job/child slot (freeing the slot never waits on a report) and retried
     * durably, so a transient main/DB outage cannot leak slots or lose a
     * terminal report. Tracked so a graceful `stop()` can drain them.
     * @type {Set<Promise<void>>}
     */
    inflightReports: Set<Promise<void>>;
    /**
     * Narrows the runtime value to the documented type.
     * @type {JsonSocket | undefined} */
    jsonSocket: JsonSocket | undefined;
    /**
     * Narrows the runtime value to the documented type.
     * @type {BackgroundJobsStatusReporter | undefined} */
    statusReporter: BackgroundJobsStatusReporter | undefined;
    /**
     * Up to `this.maxConcurrentInlineJobs` of these run in parallel. They
     * share the worker's process and DB connection pool, so concurrency is
     * about overlapping I/O waits — use forking for memory isolation across
     * long-running jobs and for using more cores.
     * @type {Set<Promise<void>>}
     */
    inflightInlineJobs: Set<Promise<void>>;
    /**
     * In-flight process runner exit promises. Tracked so process-job handoff
     * stays bounded while running and so a graceful `stop()` can drain them.
     * @type {Set<Promise<void>>}
     */
    inflightProcessJobs: Set<Promise<void>>;
    /**
     * Live process runner child processes, kept so a graceful `stop()` can
     * terminate any that outlast the shutdown drain instead of orphaning them
     * across a deploy (where they would keep running against deleted release
     * code and holding database connections).
     * @type {Set<import("node:child_process").ChildProcess>}
     */
    inflightProcessChildren: Set<import("node:child_process").ChildProcess>;
    /** @type {Set<Promise<void>>} */
    inflightPooledJobs: Set<Promise<void>>;
    /** @type {Map<string, Array<import("./types.js").BackgroundJobPayload & {id: string}>>} */
    pooledJobQueues: Map<string, Array<import("./types.js").BackgroundJobPayload & {
        id: string;
    }>>;
    /** @type {Map<string, Promise<void>>} - Per-id outer queue trackers. */
    pooledJobQueueTrackers: Map<string, Promise<void>>;
    /** @type {Set<import("node:child_process").ChildProcess>} */
    pooledChildren: Set<import("node:child_process").ChildProcess>;
    /** @type {Map<import("node:child_process").ChildProcess, PooledChildState>} */
    pooledChildStates: Map<import("node:child_process").ChildProcess, PooledChildState>;
    /** @type {WeakSet<Promise<void>>} */
    _pooledStartupFailureJobs: WeakSet<Promise<void>>;
    _pooledDispatchSeq: number;
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
    constructor({ configuration, host, port, generationId, workerInstanceId, maxConcurrentForkedJobs, maxConcurrentInlineJobs, pooledRunnerCount, pooledRunnerConcurrency, pooledRunnerMaxJobs, pooledRunnerMaxRssBytes, pooledRunnerMaxLifetimeMs, forkedChildSigkillGraceMs, heartbeatIntervalMs, generationHandshakeTimeoutMs, reconnectDelayMs, jobTimeoutMs, closeDatabaseConnectionsOnStop, onStopped, onGenerationAccepted, onRetireMessage }?: {
        configuration?: import("../configuration.js").default;
        host?: string;
        port?: number;
        generationId?: string;
        workerInstanceId?: string;
        maxConcurrentForkedJobs?: number;
        maxConcurrentInlineJobs?: number;
        pooledRunnerCount?: number;
        pooledRunnerConcurrency?: number;
        pooledRunnerMaxJobs?: number;
        pooledRunnerMaxRssBytes?: number;
        pooledRunnerMaxLifetimeMs?: number;
        forkedChildSigkillGraceMs?: number;
        heartbeatIntervalMs?: number;
        generationHandshakeTimeoutMs?: number;
        reconnectDelayMs?: number;
        jobTimeoutMs?: number;
        closeDatabaseConnectionsOnStop?: boolean;
        onStopped?: () => void | Promise<void>;
        onGenerationAccepted?: () => void;
        onRetireMessage?: () => void;
    });
    /**
     * Runs start.
     * @returns {Promise<void>} - Resolves when connected.
     */
    start(): Promise<void>;
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
    stop({ timeoutMs }?: {
        timeoutMs?: number;
    }): Promise<void>;
    /**
     * Waits for automatic or requested stop.
     * @returns {Promise<void>} - Resolves when this worker has fully stopped.
     */
    waitUntilStopped(): Promise<void>;
    /** Resets the stop observation promise for a new worker start. */
    _resetStoppedPromise(): void;
    /**
     * Runs the worker shutdown lifecycle once.
     * @param {object} [args] - Options.
     * @param {number} [args.timeoutMs] - Max wait for in-flight jobs (per phase) in ms.
     * @returns {Promise<void>} - Resolves when stopped.
     */
    _stop({ timeoutMs }?: {
        timeoutMs?: number;
    }): Promise<void>;
    /** Begins generation retirement without revoking liveness during the drain. */
    _beginGenerationRetirement(): void;
    /**
     * Drains accepted generation work while retaining the exact connection and
     * heartbeat, then performs the final terminating stop.
     * @returns {Promise<void>} - Resolves after the worker has fully closed.
     */
    _stopAfterGenerationDrain(): Promise<void>;
    /**
     * Closes application resources before framework resources when this worker owns them.
     * @returns {Promise<void>} - Resolves after every owned close succeeds.
     */
    _closeConfiguration(): Promise<void>;
    /**
     * Waits for a set of in-flight job promises to settle, optionally bounded by
     * `timeoutMs`.
     * @param {Set<Promise<void>>} inflight - In-flight job promises.
     * @param {number} [timeoutMs] - Max wait in ms; unbounded when omitted.
     * @returns {Promise<void>} - Resolves when settled or the timeout elapses.
     */
    _drainInflight(inflight: Set<Promise<void>>, timeoutMs?: number): Promise<void>;
    /**
     * Terminates any process runner children still alive after the drain window so
     * they don't outlive the worker as orphans. SIGTERM lets the runner close its
     * connections cleanly; survivors are SIGKILLed after a short grace.
     * @returns {Promise<void>} - Resolves once survivors have been signalled.
     */
    _terminateProcessChildren(): Promise<void>;
    /**
     * Connects to the worker's resolved endpoint and completes its hello fence.
     * @param {object} args - Reconnect policy.
     * @param {boolean} args.allowReconnect - Whether a failed attempt may schedule another connection.
     * @returns {Promise<void>} - Resolves after generation acknowledgement.
     */
    _connect({ allowReconnect }: {
        allowReconnect: boolean;
    }): Promise<void>;
    /** Schedules one fenced reconnect to the worker's unchanged endpoint. */
    _scheduleReconnect(): void;
    /**
     * Surfaces an unexpected worker lifecycle failure through the framework error
     * channels so a supervisor hook that ignores stdio still has observability.
     * @param {ReturnType<typeof JSON.parse>} error - Worker lifecycle failure.
     */
    _reportLifecycleError(error: ReturnType<typeof JSON.parse>): void;
    /**
     * Sends periodic liveness heartbeats to the main so a wedged or silent worker
     * can be detected and dropped there (its leases released) instead of freezing
     * the queue until a human notices.
     * @returns {void}
     */
    _startHeartbeat(): void;
    /** Sends one liveness heartbeat while the worker has not finally stopped. */
    _sendHeartbeat(): void;
    /**
     * Stops the liveness heartbeat timer.
     * @returns {void}
     */
    _stopHeartbeat(): void;
    /**
     * Runs handle job.
     * @param {import("./types.js").BackgroundJobPayload} payload - Payload.
     * @returns {Promise<void>} - Resolves when done.
     */
    _handleJob(payload: import("./types.js").BackgroundJobPayload): Promise<void>;
    /**
     * Runs start process job.
     * @param {object} args - Options.
     * @param {import("./types.js").BackgroundJobExecutionMode} args.executionMode - Execution mode.
     * @param {import("./types.js").BackgroundJobPayload & {id: string}} args.payload - Payload.
     * @returns {Promise<void>} - Resolves when the process job exits.
     */
    _startProcessJob({ executionMode, payload }: {
        executionMode: import("./types.js").BackgroundJobExecutionMode;
        payload: import("./types.js").BackgroundJobPayload & {
            id: string;
        };
    }): Promise<void>;
    /**
     * Runs handle inline job.
     * @param {import("./types.js").BackgroundJobPayload & {id: string}} payload - Payload.
     * @returns {void}
     */
    _handleInlineJob(payload: import("./types.js").BackgroundJobPayload & {
        id: string;
    }): void;
    /**
     * Runs execution mode for payload.
     * @param {import("./types.js").BackgroundJobPayload} payload - Payload.
     * @returns {import("./types.js").BackgroundJobExecutionMode} - Execution mode.
     */
    _executionModeForPayload(payload: import("./types.js").BackgroundJobPayload): import("./types.js").BackgroundJobExecutionMode;
    /**
     * Runs normalize execution mode.
     * @param {string} executionMode - Execution mode.
     * @returns {import("./types.js").BackgroundJobExecutionMode} - Normalized execution mode.
     */
    _normalizeExecutionMode(executionMode: string): import("./types.js").BackgroundJobExecutionMode;
    /**
     * Runs track process job.
     * @param {Promise<void>} processJob - Process job promise.
     * @returns {void}
     */
    _trackProcessJob(processJob: Promise<void>): void;
    /**
     * Runs run inline job and report.
     * @param {import("./types.js").BackgroundJobPayload & {id: string}} payload - Payload with required id.
     * @returns {Promise<void>} - Resolves when complete (success or failure reported).
     */
    _runInlineJobAndReport(payload: import("./types.js").BackgroundJobPayload & {
        id: string;
    }): Promise<void>;
    /**
     * Advertises current worker capacity unless the worker is draining.
     * @param {object} [options] - Advertisement options.
     * @param {boolean} [options.revokePooledAdmission] - Revoke pooled credits while preserving other execution modes.
     * @returns {void}
     */
    _sendReadyIfRunning({ revokePooledAdmission }?: {
        revokePooledAdmission?: boolean;
    }): void;
    /**
     * Runs ready message.
     * @param {object} [options] - Advertisement options.
     * @param {boolean} [options.revokePooledAdmission] - Revoke pooled credits while preserving other execution modes.
     * @returns {import("./types.js").BackgroundJobSocketMessage | null} - Ready message or null when the worker has no capacity.
     */
    _readyMessage({ revokePooledAdmission }?: {
        revokePooledAdmission?: boolean;
    }): import("./types.js").BackgroundJobSocketMessage | null;
    /**
     * Tracks a pooled job and re-advertises capacity.
     * @param {Promise<void>} pooledJob - Pooled job promise.
     * @returns {Promise<void>} - The tracked in-flight promise.
     */
    _trackPooledJob(pooledJob: Promise<void>): Promise<void>;
    /**
     * Serializes repeated leases for one durable row while preserving pooled
     * concurrency across different job ids.
     * @param {import("./types.js").BackgroundJobPayload & {id: string}} payload - Pooled job payload.
     * @returns {void}
     */
    _queuePooledJob(payload: import("./types.js").BackgroundJobPayload & {
        id: string;
    }): void;
    /**
     * Runs admitted leases for one durable job id in arrival order.
     * @param {string} jobId - Durable job id.
     * @returns {Promise<void>} - Resolves after the per-id queue drains.
     */
    _runPooledJobQueue(jobId: string): Promise<void>;
    /**
     * Free pooled slots across the pool: open slots in non-retiring children plus
     * the slots we could add by spawning more children up to `pooledRunnerCount`.
     * Retiring children (draining before replacement) never contribute capacity.
     * @returns {number} - Number of pooled jobs the worker can accept right now.
     */
    _availablePooledSlots(): number;
    /**
     * Runs a payload on a pooled child with a free concurrency slot, spawning a
     * new child when every non-retiring child is full and the pool is below
     * `pooledRunnerCount`. Each child runs up to `pooledRunnerConcurrency` jobs at
     * once on its own event loop.
     * @param {import("./types.js").BackgroundJobPayload & {id: string}} payload - Job payload.
     * @returns {Promise<void>} - Resolves after the durable report.
     */
    _runPooledJob(payload: import("./types.js").BackgroundJobPayload & {
        id: string;
    }): Promise<void>;
    /**
     * Captures the current test attempt's broker mode at dispatch time. A warm
     * pooled child must never rely on its immutable fork-time environment.
     * @returns {import("../testing/shared-transaction-proxy-driver.js").SharedTransactionBrokerJobConfig} - Per-job broker configuration.
     */
    _pooledJobSharedTransactionBrokerConfig(): import("../testing/shared-transaction-proxy-driver.js").SharedTransactionBrokerJobConfig;
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
    _selectPooledChild(): import("node:child_process").ChildProcess | undefined;
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
    _armPooledJobTimeout({ child, payload }: {
        child: import("node:child_process").ChildProcess;
        payload: import("./types.js").BackgroundJobPayload & {
            id: string;
        };
    }): ReturnType<typeof setTimeout> | null;
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
    _onPooledJobTimeout({ child, jobId }: {
        child: import("node:child_process").ChildProcess;
        jobId: string;
    }): void;
    /**
     * Creates a reusable pooled child.
     * @returns {import("node:child_process").ChildProcess} - New pooled child.
     */
    _createPooledChild(): import("node:child_process").ChildProcess;
    /**
     * Handles a pooled child's per-job durable-report acknowledgement. A child
     * runs jobs concurrently and reports one `job-outcome` per job id.
     * @param {object} args - Message details.
     * @param {import("node:child_process").ChildProcess} args.child - Pooled child.
     * @param {ReturnType<typeof JSON.parse>} args.message - IPC message.
     * @returns {void}
     */
    _handlePooledChildMessage({ child, message }: {
        child: import("node:child_process").ChildProcess;
        message: ReturnType<typeof JSON.parse>;
    }): void;
    /**
     * Marks a pooled child for retirement and eagerly spawns a single replacement
     * (1-for-1) so its capacity is restored immediately without waiting for it to
     * finish draining. The retiring child stops receiving new jobs and is
     * terminated only once its in-flight set drains, so a long-running job (e.g. a
     * build) is never cut off.
     * @param {import("node:child_process").ChildProcess} child - Child to retire.
     * @returns {void}
     */
    _beginRetirePooledChild(child: import("node:child_process").ChildProcess): void;
    /**
     * Terminates a retiring pooled child once it has no in-flight jobs left.
     * @param {import("node:child_process").ChildProcess} child - Child to check.
     * @returns {void}
     */
    _terminateIfDrained(child: import("node:child_process").ChildProcess): void;
    /**
     * Retires a drained pooled child (removes it from tracking, then SIGTERMs it).
     * @param {import("node:child_process").ChildProcess} child - Child process to retire.
     * @returns {void}
     */
    _retirePooledChild(child: import("node:child_process").ChildProcess): void;
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
    _handlePooledChildFailure({ child, error, exitCode, origin, signal }: {
        child: import("node:child_process").ChildProcess;
        error: ReturnType<typeof JSON.parse>;
        exitCode?: number | null;
        origin?: import("./types.js").PooledRunnerFailureOrigin;
        signal?: import("node:child_process").ChildProcess["signalCode"];
    }): Promise<void>;
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
    _pooledRunnerFailure({ child, exitCode, origin, signal, state }: {
        child: import("node:child_process").ChildProcess;
        exitCode: number | null;
        origin: import("./types.js").PooledRunnerFailureOrigin;
        signal: import("node:child_process").ChildProcess["signalCode"];
        state: PooledChildState;
    }): import("./types.js").PooledRunnerFailure;
    /**
     * Runs run job inline.
     * @param {import("./types.js").BackgroundJobPayload} payload - Payload.
     * @returns {Promise<void>} - Resolves when done.
     */
    _runJobInline(payload: import("./types.js").BackgroundJobPayload): Promise<void>;
    /**
     * Runs fork job.
     * @param {import("./types.js").BackgroundJobPayload & {id: string}} payload - Payload.
     * @returns {Promise<void>} - Resolves when the forked runner exits or fork fails.
     */
    _forkJob(payload: import("./types.js").BackgroundJobPayload & {
        id: string;
    }): Promise<void>;
    /**
     * Runs create forked child.
     * @returns {import("node:child_process").ChildProcess} - Forked child process.
     */
    _createForkedChild(): import("node:child_process").ChildProcess;
    /**
     * Runs wait for forked child.
     * @param {object} args - Options.
     * @param {import("node:child_process").ChildProcess} args.child - Forked child process.
     * @param {import("./types.js").BackgroundJobPayload & {id: string}} args.payload - Payload.
     * @returns {Promise<void>} - Resolves when the child exits.
     */
    _waitForForkedChild({ child, payload }: {
        child: import("node:child_process").ChildProcess;
        payload: import("./types.js").BackgroundJobPayload & {
            id: string;
        };
    }): Promise<void>;
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
    _armForkedJobTimeout({ child, payload }: {
        child: import("node:child_process").ChildProcess;
        payload: import("./types.js").BackgroundJobPayload & {
            id: string;
        };
    }): ForkedJobTimeoutState;
    /**
     * Resolves the effective wall-clock job timeout in ms (shared by forked and pooled jobs), or null when disabled. The
     * per-job override wins, followed by the constructor override, then the value
     * from the background-jobs configuration. A non-positive value disables the
     * backstop at whichever level supplied it.
     * @param {import("./types.js").BackgroundJobOptions} [jobOptions] - Per-job options.
     * @returns {number | null} - Timeout in ms, or null when disabled.
     */
    _resolveJobTimeoutMs(jobOptions?: import("./types.js").BackgroundJobOptions): number | null;
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
    _onForkedJobTimeout({ child, state }: {
        child: import("node:child_process").ChildProcess;
        state: ForkedJobTimeoutState;
    }): void;
    /**
     * Cancels any pending timeout/SIGKILL timers for a forked runner that has
     * exited (or errored) so they never fire against a gone or reused child.
     * @param {ForkedJobTimeoutState} state - Timeout state.
     * @returns {void}
     */
    _clearForkedJobTimeout(state: ForkedJobTimeoutState): void;
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
    _handleForkedChildExit({ child, code, signal, payload, resolve, timeoutState }: {
        child: import("node:child_process").ChildProcess;
        code: number | null;
        signal: keyof typeof import("node:os").constants.signals | null;
        payload: import("./types.js").BackgroundJobPayload & {
            id: string;
        };
        resolve: (value: void) => void;
        timeoutState?: ForkedJobTimeoutState;
    }): void;
    /**
     * Runs forked child exited cleanly.
     * @param {object} args - Options.
     * @param {number | null} args.code - Exit code.
     * @param {keyof typeof import("node:os").constants.signals | null} args.signal - Exit signal.
     * @returns {boolean} - Whether the child exited cleanly.
     */
    _forkedChildExitedCleanly({ code, signal }: {
        code: number | null;
        signal: keyof typeof import("node:os").constants.signals | null;
    }): boolean;
    /**
     * Runs handle forked child error.
     * @param {object} args - Options.
     * @param {import("node:child_process").ChildProcess} args.child - Forked child process.
     * @param {Error} args.error - Child process error.
     * @param {import("./types.js").BackgroundJobPayload & {id: string}} args.payload - Payload.
     * @param {(value: void) => void} args.resolve - Promise resolver.
     * @returns {void}
     */
    _handleForkedChildError({ child, error, payload, resolve }: {
        child: import("node:child_process").ChildProcess;
        error: Error;
        payload: import("./types.js").BackgroundJobPayload & {
            id: string;
        };
        resolve: (value: void) => void;
    }): void;
    /**
     * Runs send forked payload.
     * @param {object} args - Options.
     * @param {import("node:child_process").ChildProcess} args.child - Forked child process.
     * @param {import("./types.js").BackgroundJobPayload & {id: string}} args.payload - Payload.
     * @returns {void}
     */
    _sendForkedPayload({ child, payload }: {
        child: import("node:child_process").ChildProcess;
        payload: import("./types.js").BackgroundJobPayload & {
            id: string;
        };
    }): void;
    /**
     * Runs report forked child failure.
     * @param {object} args - Options.
     * @param {import("./types.js").BackgroundJobPayload & {id: string}} args.payload - Payload.
     * @param {ReturnType<typeof JSON.parse>} args.error - Error.
     * @returns {void}
     */
    _reportForkedChildFailure({ payload, error }: {
        payload: import("./types.js").BackgroundJobPayload & {
            id: string;
        };
        error: ReturnType<typeof JSON.parse>;
    }): void;
    /**
     * Runs spawn job.
     * @param {import("./types.js").BackgroundJobPayload} payload - Payload.
     * @returns {Promise<void>} - Resolves when the spawned runner exits or spawn fails.
     */
    _spawnJob(payload: import("./types.js").BackgroundJobPayload): Promise<void>;
    /**
     * Builds the exact main endpoint and generation inherited by every child.
     * @returns {Record<string, string>} - Child process environment additions.
     */
    _childBackgroundJobsEnvironment(): Record<string, string>;
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
    _reportJobResult({ jobId, status, delayMs, error, handoffId, handedOffAtMs, workerId, runnerFailure }: {
        jobId: string;
        status: "completed" | "failed" | "rescheduled";
        delayMs?: number;
        error?: ReturnType<typeof JSON.parse>;
        handoffId?: string;
        handedOffAtMs?: number;
        workerId?: string;
        runnerFailure?: import("./types.js").PooledRunnerFailure;
    }): Promise<void>;
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
    _reportJobResultInBackground({ jobId, status, delayMs, error, handoffId, handedOffAtMs, workerId, runnerFailure }: {
        jobId: string;
        status: "completed" | "failed" | "rescheduled";
        delayMs?: number;
        error?: ReturnType<typeof JSON.parse>;
        handoffId?: string;
        handedOffAtMs?: number;
        workerId?: string;
        runnerFailure?: import("./types.js").PooledRunnerFailure;
    }): void;
}
//# sourceMappingURL=worker.d.ts.map