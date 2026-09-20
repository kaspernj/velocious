/** Expected cooperative cancellation raised by a SyncCoordinator lifecycle transition. */
export declare class SyncCoordinatorLifecycleAbortError extends Error {
    /**
     * Creates a lifecycle cancellation error.
     * @param {string} message - Cancellation reason.
     */
    constructor(message: string);
}
/**
 * Reusable observable lifecycle around SyncClient. It serializes replay,
 * realtime subscription, and stable-cursor pull into one cycle; coalesces any
 * triggers received during that cycle into one rerun; owns bounded retry; and
 * generation-fences status updates after stop/restart.
 */
export default class SyncCoordinator {
    syncClient: import("./sync-client.js").default;
    classifyError: (error: Error) => {
        code: string;
        message?: string;
        retryable: boolean;
    };
    connectivity: import("./sync-coordinator-types.js").SyncCoordinatorConnectivity | null;
    now: () => Date;
    prepare: (args: {
        signal: AbortSignal;
        syncClient: import("./sync-client.js").default;
    }) => Promise<(() => Promise<void> | void) | void> | (() => Promise<void> | void) | void;
    realtime: boolean;
    retryPolicy: {
        initialDelayMs: number;
        maxAttempts: number;
        maxDelayMs: number;
    };
    scheduler: import("./sync-coordinator-types.js").SyncCoordinatorScheduler;
    statusStore: import("./sync-coordinator-types.js").SyncCoordinatorStatusStore | null;
    _active: boolean;
    _attempt: number;
    _generation: number;
    _lifecycleAbortController: AbortController;
    /** @type {Set<(status: import("./sync-coordinator-types.js").SyncCoordinatorStatus) => void>} */
    _listeners: Set<(status: import("./sync-coordinator-types.js").SyncCoordinatorStatus) => void>;
    /** @type {Array<() => Promise<void> | void>} */
    _lifecycleCleanups: Array<() => Promise<void> | void>;
    /** @type {Promise<void> | null} */
    _runPromise: Promise<void> | null;
    _rerunRequested: boolean;
    /** @type {unknown} */
    _retryTimer: unknown;
    /** @type {Promise<void> | null} */
    _startPromise: Promise<void> | null;
    /** @type {Promise<void> | null} */
    _stopPromise: Promise<void> | null;
    /** @type {import("./sync-coordinator-types.js").SyncCoordinatorStatus} */
    _status: import("./sync-coordinator-types.js").SyncCoordinatorStatus;
    /**
     * Creates one reusable sync lifecycle owner.
     * @param {object} args - Coordinator dependencies.
     * @param {(error: Error) => {code: string, message?: string, retryable: boolean}} [args.classifyError] - Maps errors to safe retry/display metadata. Defaults to permanent `sync_failed` without persisting the error message.
     * @param {import("./sync-coordinator-types.js").SyncCoordinatorConnectivity} [args.connectivity] - Optional connectivity event source.
     * @param {() => Date} [args.now] - Injected clock.
     * @param {(args: {signal: AbortSignal, syncClient: import("./sync-client.js").default}) => Promise<(() => Promise<void> | void) | void> | (() => Promise<void> | void) | void} [args.prepare] - Activates scopes/acquires app-owned resources before the first cycle and returns their teardown.
     * @param {boolean} [args.realtime] - Whether cycles subscribe realtime before pulling. Defaults to true.
     * @param {{initialDelayMs?: number, maxAttempts?: number, maxDelayMs?: number}} [args.retry] - Bounded automatic retry policy.
     * @param {import("./sync-coordinator-types.js").SyncCoordinatorScheduler} [args.scheduler] - Injected timer owner.
     * @param {import("./sync-coordinator-types.js").SyncCoordinatorStatusStore} [args.statusStore] - Optional privacy-safe durable status store.
     * @param {import("./sync-client.js").default} args.syncClient - SyncClient owning queue, scopes, cursors, apply, and realtime.
     */
    constructor({ classifyError, connectivity, now, prepare, realtime, retry, scheduler, statusStore, syncClient, ...restArgs }: {
        classifyError?: (error: Error) => {
            code: string;
            message?: string;
            retryable: boolean;
        };
        connectivity?: import("./sync-coordinator-types.js").SyncCoordinatorConnectivity;
        now?: () => Date;
        prepare?: (args: {
            signal: AbortSignal;
            syncClient: import("./sync-client.js").default;
        }) => Promise<(() => Promise<void> | void) | void> | (() => Promise<void> | void) | void;
        realtime?: boolean;
        retry?: {
            initialDelayMs?: number;
            maxAttempts?: number;
            maxDelayMs?: number;
        };
        scheduler?: import("./sync-coordinator-types.js").SyncCoordinatorScheduler;
        statusStore?: import("./sync-coordinator-types.js").SyncCoordinatorStatusStore;
        syncClient: import("./sync-client.js").default;
    });
    /**
     * Installs local ownership and schedules the initial network cycle without
     * awaiting it, so cached reads never depend on network completion.
     * @returns {Promise<void>} - Resolves after local ownership is installed.
     */
    start(): Promise<void>;
    /**
     * Starts one lifecycle generation with rollback on failure.
     * @param {number} generation - Owning generation.
     * @returns {Promise<void>} - Resolves after activation completes.
     */
    _start(generation: number): Promise<void>;
    /**
     * Acquires coordinator, connectivity, client, and application resources.
     * @param {number} generation - Owning generation.
     * @returns {Promise<void>} - Resolves after every owner is active.
     */
    _activate(generation: number): Promise<void>;
    /**
     * Releases every partially acquired owner after a failed start, publishes a
     * safe terminal failure, and rethrows the original error (or an aggregate if
     * teardown also failed).
     * @param {Error} error - Start failure.
     * @param {number} generation - Failed generation.
     * @returns {Promise<never>} - Always rejects with the start or aggregate error.
     */
    _rollbackFailedStart(error: Error, generation: number): Promise<never>;
    /**
     * Stops current work, clears timers/listeners, drains SyncClient, and releases
     * app-owned resources exactly once.
     * @returns {Promise<void>} - Resolves after the lifecycle is fully stopped.
     */
    stop(): Promise<void>;
    /**
     * Drains captured lifecycle resources after a stop transition.
     * @param {{cleanups: Array<() => Promise<void> | void>, runPromise: Promise<void> | null, startPromise: Promise<void> | null}} args - Captured generation resources.
     * @returns {Promise<void>} - Resolves after teardown completes.
     */
    _stop({ cleanups, runPromise, startPromise }: {
        cleanups: Array<() => Promise<void> | void>;
        runPromise: Promise<void> | null;
        startPromise: Promise<void> | null;
    }): Promise<void>;
    /**
     * Requests a cycle. Overlapping requests share the active flight and produce
     * at most one queued rerun.
     * @param {string} [reason] - Diagnostic trigger label (never persisted).
     * @returns {Promise<void>} - Resolves after the current or queued cycle drains.
     */
    trigger(reason?: string): Promise<void>;
    /**
     * Starts requested work only after lifecycle preparation has completed.
     * @returns {Promise<void>} - Current or newly started coordinator flight.
     */
    _startRequestedRun(): Promise<void>;
    /**
     * Clears backoff and requests one single-flight user retry.
     * @returns {Promise<void>} - Resolves after the retry cycle drains.
     */
    retry(): Promise<void>;
    /**
     * Resolves one durable conflict through SyncClient, then refreshes status and
     * replays retry-local intent through the same cycle.
     * @param {{recordId: string, resolution: "keep-server" | "retry-local", resourceType: string}} args - Explicit resolution.
     * @returns {Promise<void>} - Resolves after resolution state is refreshed.
     */
    resolveConflict(args: {
        recordId: string;
        resolution: "keep-server" | "retry-local";
        resourceType: string;
    }): Promise<void>;
    /**
     * Drains requested work serially for one lifecycle generation.
     * @param {number} generation - Owning generation.
     * @returns {Promise<void>} - Resolves when no immediate rerun remains.
     */
    _drain(generation: number): Promise<void>;
    /**
     * Runs one replay, realtime-subscribe, and pull cycle.
     * @param {number} generation - Owning generation.
     * @returns {Promise<boolean>} - Whether an immediate queued rerun may proceed.
     */
    _runCycle(generation: number): Promise<boolean>;
    /**
     * Publishes a classified failure and owns its bounded retry timer.
     * @param {Error} error - Cycle failure.
     * @param {number} generation - Owning generation.
     * @returns {Promise<void>} - Resolves after status persistence and scheduling.
     */
    _handleFailure(error: Error, generation: number): Promise<void>;
    /**
     * Persists the current safe status for an active generation.
     * @param {number} generation - Owning generation.
     * @returns {Promise<void>} - Resolves after persistence.
     */
    _persistStatus(generation: number): Promise<void>;
    /**
     * Coalesces one connectivity change into the coordinator cycle.
     * @param {{generation: number, online: boolean}} args - Connectivity event.
     * @returns {void}
     */
    _connectivityChanged({ generation, online }: {
        generation: number;
        online: boolean;
    }): void;
    /**
     * Clears the currently owned retry timer, if present.
     * @returns {void}
     */
    _clearRetryTimer(): void;
    /**
     * Checks whether a lifecycle generation still owns state updates.
     * @param {number} generation - Expected generation.
     * @returns {boolean} - Whether the generation is current and active.
     */
    _ownsGeneration(generation: number): boolean;
    /**
     * Fails when work no longer belongs to the active generation.
     * @param {number} generation - Expected generation.
     * @returns {void}
     */
    _assertActive(generation: number): void;
    /**
     * Identifies coordinator-owned cooperative cancellation.
     * @param {unknown} error - Candidate error.
     * @returns {boolean} - Whether this coordinator created the abort error.
     */
    isLifecycleAbort(error: unknown): boolean;
    /**
     * Reads and validates the injected clock.
     * @returns {string} - Valid ISO clock value.
     */
    _nowIso(): string;
    /**
     * Freezes and publishes a new observable snapshot.
     * @param {import("./sync-coordinator-types.js").SyncCoordinatorStatus} status - New status.
     * @returns {void}
     */
    _publish(status: import("./sync-coordinator-types.js").SyncCoordinatorStatus): void;
    /**
     * Returns the current observable snapshot.
     * @returns {import("./sync-coordinator-types.js").SyncCoordinatorStatus} - Current immutable snapshot.
     */
    status(): import("./sync-coordinator-types.js").SyncCoordinatorStatus;
    /**
     * Observes status and receives the current snapshot immediately.
     * @param {(status: import("./sync-coordinator-types.js").SyncCoordinatorStatus) => void} listener - Observer.
     * @returns {() => void} - Idempotent unsubscribe.
     */
    subscribe(listener: (status: import("./sync-coordinator-types.js").SyncCoordinatorStatus) => void): () => void;
    /**
     * Awaits only the active or queued cycle, not a future backoff timer.
     * @returns {Promise<void>} - Resolves when current work drains.
     */
    waitForCurrentRun(): Promise<void>;
}
//# sourceMappingURL=sync-coordinator.d.ts.map