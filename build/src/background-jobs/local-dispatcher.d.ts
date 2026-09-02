export type LocalBackgroundJobAcknowledgement = {
    type: "completed";
} | {
    type: "failed";
    error: ReturnType<typeof JSON.parse>;
} | {
    type: "rescheduled";
    delayMs: number;
};
export type PendingLocalBackgroundJobAcknowledgement = {
    /**
     * - Durable transition still owned by this dispatcher.
     */
    acknowledgement: LocalBackgroundJobAcknowledgement;
    /**
     * - Fenced handoff being acknowledged.
     */
    handoff: import("./types.js").BackgroundJobHandoff;
    /**
     * - Claimed job snapshot.
     */
    job: import("./types.js").BackgroundJobRow;
};
/** Configuration-owned, event-driven in-process local dispatcher. */
export default class LocalBackgroundJobsDispatcher {
    clock: import("./types.js").LocalBackgroundJobsClock;
    configuration: import("../configuration.js").default;
    registry: import("./local-job-registry.js").default;
    store: import("./local-store.js").default;
    _accepting: boolean;
    _started: boolean;
    /** @type {Promise<void> | null} */
    _startPromise: Promise<void> | null;
    /** @type {Promise<void> | null} */
    _drainPromise: Promise<void> | null;
    _redrain: boolean;
    _wakeQueued: boolean;
    /** @type {Set<Promise<void>>} */
    _inFlight: Set<Promise<void>>;
    /** @type {Map<string, PendingLocalBackgroundJobAcknowledgement>} */
    _pendingAcknowledgements: Map<string, PendingLocalBackgroundJobAcknowledgement>;
    /** @type {Set<() => void>} */
    _idleWaiters: Set<() => void>;
    /** @type {ReturnType<typeof setTimeout> | number | undefined} */
    _scheduledTimer: ReturnType<typeof setTimeout> | number | undefined;
    /** @type {ReturnType<typeof setTimeout> | number | undefined} */
    _recoveryTimer: ReturnType<typeof setTimeout> | number | undefined;
    /**
     * Creates a dispatcher owned by one configuration and local store.
     * @param {object} args - Dispatcher options.
     * @param {import("../configuration.js").default} args.configuration - Owning configuration.
     * @param {import("./types.js").LocalBackgroundJobsClock} args.clock - Dispatcher clock.
     * @param {import("./local-job-registry.js").default} args.registry - Static job registry.
     * @param {import("./local-store.js").default} args.store - Durable local store.
     */
    constructor({ configuration, clock, registry, store }: {
        configuration: import("../configuration.js").default;
        clock: import("./types.js").LocalBackgroundJobsClock;
        registry: import("./local-job-registry.js").default;
        store: import("./local-store.js").default;
    });
    /**
     * Starts, recovers, and catches up the local dispatcher.
     * @returns {Promise<void>} - Resolves after admission starts.
     */
    start(): Promise<void>;
    /**
     * Coalesces a dispatcher wake onto one tracked microtask.
     * @returns {void} - No return value.
     */
    wake(): void;
    /**
     * Fills local capacity with short durable claims.
     * @returns {Promise<void>} - Resolves after one stable drain pass.
     */
    _drain(): Promise<void>;
    /**
     * Runs one claimed performance without retaining its claim transaction connection.
     * @param {{handoff: import("./types.js").BackgroundJobHandoff, job: import("./types.js").BackgroundJobRow}} args - Claimed job.
     * @returns {void} - No return value.
     */
    _startPerformance({ handoff, job }: {
        handoff: import("./types.js").BackgroundJobHandoff;
        job: import("./types.js").BackgroundJobRow;
    }): void;
    /**
     * Performs and acknowledges one durable handoff.
     * @param {{handoff: import("./types.js").BackgroundJobHandoff, job: import("./types.js").BackgroundJobRow}} args - Claimed job.
     * @returns {Promise<void>} - Resolves after acknowledgement.
     */
    _perform({ handoff, job }: {
        handoff: import("./types.js").BackgroundJobHandoff;
        job: import("./types.js").BackgroundJobRow;
    }): Promise<void>;
    /**
     * Applies one fenced durable acknowledgement.
     * @param {PendingLocalBackgroundJobAcknowledgement} args - Owned acknowledgement.
     * @returns {Promise<void>} - Resolves after the durable transition is settled.
     */
    _acknowledge({ acknowledgement, handoff, job }: PendingLocalBackgroundJobAcknowledgement): Promise<void>;
    /**
     * Replays each retained acknowledgement once at an event-driven wake boundary.
     * @param {{throwOnError?: boolean}} [args] - Recovery behavior.
     * @returns {Promise<void>} - Resolves after one bounded recovery pass.
     */
    _retryPendingAcknowledgements({ throwOnError }?: {
        throwOnError?: boolean;
    }): Promise<void>;
    /**
     * Arms the exact next future job timer, chunking platform-sized delays.
     * @returns {Promise<void>} - Resolves after timer reconciliation.
     */
    _armScheduledTimer(): Promise<void>;
    /**
     * Arms one bounded retry after an unexpected drain failure.
     * @returns {void} - No return value.
     */
    _armRecoveryTimer(): void;
    /**
     * Waits for admission and every in-flight acknowledgement without polling.
     * @returns {Promise<void>} - Resolves when idle.
     */
    waitForIdle(): Promise<void>;
    /**
     * Stops claims and waits for in-flight acknowledgement.
     * @returns {Promise<void>} - Resolves after a graceful stop.
     */
    stop(): Promise<void>;
    /**
     * Reports whether dispatcher admission has started.
     * @returns {boolean} - Whether dispatcher admission has started.
     */
    isReady(): boolean;
    /**
     * Reads the configuration-owned in-process performance cap.
     * @returns {number} - Configuration-owned in-process performance cap.
     */
    _maxConcurrentJobs(): number;
    /**
     * Counts performances whose durable acknowledgement is still owned locally.
     * @returns {number} - Active or pending-acknowledgement performances.
     */
    _ownedPerformanceCount(): number;
    /**
     * Reports whether no admission or acknowledgement work remains.
     * @returns {boolean} - Whether the dispatcher is idle.
     */
    _isIdle(): boolean;
    /**
     * Resolves event-based idle waiters at a stable idle boundary.
     * @returns {void} - No return value.
     */
    _resolveIdleWaiters(): void;
    /**
     * Emits an expected job failure through the standard job/all-error channels.
     * @param {{error: ReturnType<typeof JSON.parse>, job: import("./types.js").BackgroundJobRow}} args - Failure transition.
     * @returns {void} - No return value.
     */
    _emitBackgroundJobFailed({ error, job }: {
        error: ReturnType<typeof JSON.parse>;
        job: import("./types.js").BackgroundJobRow;
    }): void;
    /**
     * Reports one failed durable acknowledgement attempt with its fence context.
     * @param {PendingLocalBackgroundJobAcknowledgement & {error: ReturnType<typeof JSON.parse>}} args - Failed acknowledgement.
     * @returns {void} - No return value.
     */
    _reportAcknowledgementError({ acknowledgement, error, handoff, job }: PendingLocalBackgroundJobAcknowledgement & {
        error: ReturnType<typeof JSON.parse>;
    }): void;
    /**
     * Reports an unexpected dispatcher failure through framework channels.
     * @param {object} args - Unexpected failure.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.context] - Additional failure context.
     * @param {ReturnType<typeof JSON.parse>} args.error - Unexpected error.
     * @param {string} args.stage - Dispatcher stage.
     * @returns {void} - No return value.
     */
    _reportFrameworkError({ context, error, stage }: {
        context?: Record<string, ReturnType<typeof JSON.parse>>;
        error: ReturnType<typeof JSON.parse>;
        stage: string;
    }): void;
}
//# sourceMappingURL=local-dispatcher.d.ts.map