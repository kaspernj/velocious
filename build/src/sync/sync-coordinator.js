// @ts-check
import restArgsError from "../utils/rest-args-error.js";
const COORDINATOR_STATES = new Set(["backoff", "conflicted", "failed", "idle", "offline", "pending", "stopped", "syncing"]);
const DEFAULT_RETRY = Object.freeze({ initialDelayMs: 1_000, maxAttempts: 4, maxDelayMs: 30_000 });
/** Expected cooperative cancellation raised by a SyncCoordinator lifecycle transition. */
export class SyncCoordinatorLifecycleAbortError extends Error {
    /**
     * Creates a lifecycle cancellation error.
     * @param {string} message - Cancellation reason.
     */
    constructor(message) {
        super(message);
        this.name = "SyncCoordinatorLifecycleAbortError";
    }
}
/**
 * Reusable observable lifecycle around SyncClient. It serializes replay,
 * realtime subscription, and stable-cursor pull into one cycle; coalesces any
 * triggers received during that cycle into one rerun; owns bounded retry; and
 * generation-fences status updates after stop/restart.
 */
export default class SyncCoordinator {
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
    constructor({ classifyError = defaultErrorClassification, connectivity, now = () => new Date(), prepare = () => undefined, realtime = true, retry = {}, scheduler = defaultScheduler(), statusStore, syncClient, ...restArgs }) {
        restArgsError(restArgs);
        requireCoordinatorClient(syncClient);
        requireFunction(classifyError, "classifyError");
        requireFunction(now, "now");
        requireFunction(prepare, "prepare");
        if (typeof realtime !== "boolean")
            throw new Error("SyncCoordinator realtime must be boolean");
        if (connectivity)
            requireFunction(connectivity.subscribe, "connectivity.subscribe");
        if (statusStore) {
            requireFunction(statusStore.load, "statusStore.load");
            requireFunction(statusStore.save, "statusStore.save");
        }
        requireFunction(scheduler.clearTimeout, "scheduler.clearTimeout");
        requireFunction(scheduler.setTimeout, "scheduler.setTimeout");
        this.syncClient = syncClient;
        this.classifyError = classifyError;
        this.connectivity = connectivity || null;
        this.now = now;
        this.prepare = prepare;
        this.realtime = realtime;
        this.retryPolicy = normalizeRetryPolicy(retry);
        this.scheduler = scheduler;
        this.statusStore = statusStore || null;
        this._active = false;
        this._attempt = 0;
        this._generation = 0;
        this._lifecycleAbortController = new AbortController();
        /** @type {Set<(status: import("./sync-coordinator-types.js").SyncCoordinatorStatus) => void>} */
        this._listeners = new Set();
        /** @type {Array<() => Promise<void> | void>} */
        this._lifecycleCleanups = [];
        /** @type {Promise<void> | null} */
        this._runPromise = null;
        this._rerunRequested = false;
        /** @type {unknown} */
        this._retryTimer = null;
        /** @type {Promise<void> | null} */
        this._startPromise = null;
        /** @type {Promise<void> | null} */
        this._stopPromise = null;
        /** @type {import("./sync-coordinator-types.js").SyncCoordinatorStatus} */
        this._status = immutableStatus({
            conflicts: [],
            failure: null,
            lastSuccessAt: null,
            nextRetryAt: null,
            pendingCount: 0,
            rejectedCount: 0,
            state: "stopped"
        });
    }
    /**
     * Installs local ownership and schedules the initial network cycle without
     * awaiting it, so cached reads never depend on network completion.
     * @returns {Promise<void>} - Resolves after local ownership is installed.
     */
    start() {
        if (this._active && !this._startPromise)
            return Promise.resolve();
        if (this._startPromise)
            return this._startPromise;
        if (this._stopPromise)
            return this._stopPromise.then(async () => await this.start());
        this._active = true;
        this._attempt = 0;
        const generation = ++this._generation;
        this._lifecycleAbortController = new AbortController();
        this._startPromise = this._start(generation).finally(() => {
            this._startPromise = null;
        });
        return this._startPromise;
    }
    /**
     * Starts one lifecycle generation with rollback on failure.
     * @param {number} generation - Owning generation.
     * @returns {Promise<void>} - Resolves after activation completes.
     */
    async _start(generation) {
        try {
            await this._activate(generation);
        }
        catch (error) {
            if (this.isLifecycleAbort(error) || !this._ownsGeneration(generation))
                throw error;
            await this._rollbackFailedStart(/** @type {Error} */ (error), generation);
        }
    }
    /**
     * Acquires coordinator, connectivity, client, and application resources.
     * @param {number} generation - Owning generation.
     * @returns {Promise<void>} - Resolves after every owner is active.
     */
    async _activate(generation) {
        if (this.statusStore) {
            const persistedStatus = await this.statusStore.load();
            this._assertActive(generation);
            if (persistedStatus)
                this._publish(restoredStatus(persistedStatus));
        }
        const detachCoordinator = this.syncClient.attachCoordinator(async (reason) => await this.trigger(reason));
        this._lifecycleCleanups.push(detachCoordinator);
        if (this.connectivity) {
            const unsubscribeConnectivity = this.connectivity.subscribe((online) => this._connectivityChanged({ generation, online }));
            this._lifecycleCleanups.push(unsubscribeConnectivity);
        }
        this._assertActive(generation);
        await this.syncClient.start();
        this._assertActive(generation);
        const release = await this.prepare({ signal: this._lifecycleAbortController.signal, syncClient: this.syncClient });
        if (release !== undefined)
            requireFunction(release, "prepare teardown");
        if (!this._ownsGeneration(generation)) {
            if (release)
                await release();
            throw new SyncCoordinatorLifecycleAbortError("Sync coordinator stopped during preparation");
        }
        if (release)
            this._lifecycleCleanups.push(release);
        this._rerunRequested = true;
        void this._startRequestedRun();
    }
    /**
     * Releases every partially acquired owner after a failed start, publishes a
     * safe terminal failure, and rethrows the original error (or an aggregate if
     * teardown also failed).
     * @param {Error} error - Start failure.
     * @param {number} generation - Failed generation.
     * @returns {Promise<never>} - Always rejects with the start or aggregate error.
     */
    async _rollbackFailedStart(error, generation) {
        this._active = false;
        this._generation += 1;
        this._lifecycleAbortController.abort(new SyncCoordinatorLifecycleAbortError("Sync coordinator start failed"));
        this._rerunRequested = false;
        this._clearRetryTimer();
        /** @type {unknown[]} */
        const teardownErrors = [];
        const cleanups = this._lifecycleCleanups.splice(0).reverse();
        try {
            await this.syncClient.stop();
        }
        catch (stopError) {
            teardownErrors.push(stopError);
        }
        for (const cleanup of cleanups) {
            try {
                await cleanup();
            }
            catch (cleanupError) {
                teardownErrors.push(cleanupError);
            }
        }
        const classified = normalizeErrorClassification(this.classifyError(error));
        const failure = {
            attempt: 1,
            at: this._nowIso(),
            code: classified.code,
            ...(classified.message === undefined ? {} : { message: classified.message }),
            retryable: classified.retryable
        };
        this._attempt = 1;
        this._publish({ ...this._status, failure, nextRetryAt: null, state: "failed" });
        if (this.statusStore) {
            try {
                await this.statusStore.save(this._status);
            }
            catch (persistenceError) {
                teardownErrors.push(persistenceError);
            }
        }
        if (teardownErrors.length > 0)
            throw new AggregateError([error, ...teardownErrors], `Sync coordinator generation ${generation} failed to start and tear down cleanly`);
        throw error;
    }
    /**
     * Stops current work, clears timers/listeners, drains SyncClient, and releases
     * app-owned resources exactly once.
     * @returns {Promise<void>} - Resolves after the lifecycle is fully stopped.
     */
    stop() {
        if (this._stopPromise)
            return this._stopPromise;
        if (!this._active && !this._startPromise && !this._runPromise) {
            if (this._status.state !== "stopped")
                this._publish({ ...this._status, nextRetryAt: null, state: "stopped" });
            return Promise.resolve();
        }
        this._active = false;
        this._generation += 1;
        this._lifecycleAbortController.abort(new SyncCoordinatorLifecycleAbortError("Sync coordinator was stopped"));
        this._rerunRequested = false;
        this._clearRetryTimer();
        const cleanups = this._lifecycleCleanups.splice(0).reverse();
        const startPromise = this._startPromise;
        const runPromise = this._runPromise;
        this._stopPromise = this._stop({ cleanups, runPromise, startPromise }).finally(() => {
            this._stopPromise = null;
        });
        return this._stopPromise;
    }
    /**
     * Drains captured lifecycle resources after a stop transition.
     * @param {{cleanups: Array<() => Promise<void> | void>, runPromise: Promise<void> | null, startPromise: Promise<void> | null}} args - Captured generation resources.
     * @returns {Promise<void>} - Resolves after teardown completes.
     */
    async _stop({ cleanups, runPromise, startPromise }) {
        /** @type {unknown[]} */
        const errors = [];
        try {
            await this.syncClient.stop();
        }
        catch (error) {
            errors.push(error);
        }
        for (const promise of [startPromise, runPromise]) {
            if (!promise)
                continue;
            try {
                await promise;
            }
            catch (error) {
                if (!this.isLifecycleAbort(error))
                    errors.push(error);
            }
        }
        for (const cleanup of cleanups) {
            try {
                await cleanup();
            }
            catch (error) {
                errors.push(error);
            }
        }
        this._attempt = 0;
        this._publish({ ...this._status, failure: null, nextRetryAt: null, state: "stopped" });
        if (errors.length === 1)
            throw errors[0];
        if (errors.length > 1)
            throw new AggregateError(errors, "Sync coordinator teardown failed");
    }
    /**
     * Requests a cycle. Overlapping requests share the active flight and produce
     * at most one queued rerun.
     * @param {string} [reason] - Diagnostic trigger label (never persisted).
     * @returns {Promise<void>} - Resolves after the current or queued cycle drains.
     */
    trigger(reason = "manual") {
        void reason;
        if (!this._active)
            return Promise.resolve();
        this._rerunRequested = true;
        if (this._startPromise) {
            return this._startPromise.then(async () => await this._startRequestedRun(), () => undefined);
        }
        return this._startRequestedRun();
    }
    /**
     * Starts requested work only after lifecycle preparation has completed.
     * @returns {Promise<void>} - Current or newly started coordinator flight.
     */
    _startRequestedRun() {
        if (!this._active)
            return Promise.resolve();
        if (this._retryTimer !== null)
            return this._runPromise || Promise.resolve();
        if (!this._runPromise) {
            const generation = this._generation;
            this._runPromise = this._drain(generation).finally(() => {
                this._runPromise = null;
            });
        }
        return this._runPromise;
    }
    /**
     * Clears backoff and requests one single-flight user retry.
     * @returns {Promise<void>} - Resolves after the retry cycle drains.
     */
    retry() {
        if (!this._active)
            throw new Error("Cannot retry a stopped SyncCoordinator");
        this._clearRetryTimer();
        this._attempt = 0;
        return this.trigger("manual-retry");
    }
    /**
     * Resolves one durable conflict through SyncClient, then refreshes status and
     * replays retry-local intent through the same cycle.
     * @param {{recordId: string, resolution: "keep-server" | "retry-local", resourceType: string}} args - Explicit resolution.
     * @returns {Promise<void>} - Resolves after resolution state is refreshed.
     */
    async resolveConflict(args) {
        if (!this._active)
            throw new Error("Cannot resolve a conflict on a stopped SyncCoordinator");
        await this.syncClient.resolveConflict(args);
        this._clearRetryTimer();
        this._attempt = 0;
        if (args.resolution === "retry-local") {
            await this.syncClient.waitForScheduledReplay();
        }
        else {
            await this.trigger("conflict-resolution");
        }
    }
    /**
     * Drains requested work serially for one lifecycle generation.
     * @param {number} generation - Owning generation.
     * @returns {Promise<void>} - Resolves when no immediate rerun remains.
     */
    async _drain(generation) {
        while (this._rerunRequested && this._ownsGeneration(generation)) {
            this._rerunRequested = false;
            const completed = await this._runCycle(generation);
            if (!completed)
                this._rerunRequested = false;
        }
    }
    /**
     * Runs one replay, realtime-subscribe, and pull cycle.
     * @param {number} generation - Owning generation.
     * @returns {Promise<boolean>} - Whether an immediate queued rerun may proceed.
     */
    async _runCycle(generation) {
        try {
            const online = await this.syncClient.isOnline();
            this._assertActive(generation);
            if (!online) {
                const inspection = await this.syncClient.inspectSyncState();
                this._assertActive(generation);
                this._publish({ ...this._status, ...inspection, failure: null, nextRetryAt: null, state: "offline" });
                await this._persistStatus(generation);
                return false;
            }
            this._publish({ ...this._status, nextRetryAt: null, state: "syncing" });
            await this.syncClient.replayPending();
            this._assertActive(generation);
            if (this.realtime) {
                await this.syncClient.subscribeRealtime();
                this._assertActive(generation);
            }
            await this.syncClient.pull();
            this._assertActive(generation);
            const inspection = await this.syncClient.inspectSyncState();
            this._assertActive(generation);
            this._publish({
                ...this._status,
                ...inspection,
                failure: null,
                lastSuccessAt: this._nowIso(),
                nextRetryAt: null,
                state: inspectionState(inspection)
            });
            await this._persistStatus(generation);
            this._attempt = 0;
            return true;
        }
        catch (error) {
            if (!this._ownsGeneration(generation) || this.isLifecycleAbort(error) || this.syncClient.isLifecycleAbort(error))
                return false;
            await this._handleFailure(/** @type {Error} */ (error), generation);
            return false;
        }
    }
    /**
     * Publishes a classified failure and owns its bounded retry timer.
     * @param {Error} error - Cycle failure.
     * @param {number} generation - Owning generation.
     * @returns {Promise<void>} - Resolves after status persistence and scheduling.
     */
    async _handleFailure(error, generation) {
        this._attempt += 1;
        let classified = normalizeErrorClassification(this.classifyError(error));
        const failedAt = this._nowIso();
        let failureStatus = failureStatusFor({ attempt: this._attempt, classified, failedAt, retryPolicy: this.retryPolicy, status: this._status });
        this._publish(failureStatus.status);
        if (this.statusStore) {
            try {
                await this.statusStore.save(this._status);
                this._assertActive(generation);
            }
            catch (persistenceError) {
                this._assertActive(generation);
                classified = normalizeErrorClassification(this.classifyError(/** @type {Error} */ (persistenceError)));
                failureStatus = failureStatusFor({ attempt: this._attempt, classified, failedAt, retryPolicy: this.retryPolicy, status: this._status });
                this._publish(failureStatus.status);
            }
        }
        if (failureStatus.delayMs !== null) {
            this._assertActive(generation);
            this._retryTimer = this.scheduler.setTimeout(() => {
                this._retryTimer = null;
                if (!this._ownsGeneration(generation))
                    return;
                void this.trigger("automatic-retry");
            }, failureStatus.delayMs);
        }
        this.syncClient.reportError(error);
    }
    /**
     * Persists the current safe status for an active generation.
     * @param {number} generation - Owning generation.
     * @returns {Promise<void>} - Resolves after persistence.
     */
    async _persistStatus(generation) {
        if (this.statusStore)
            await this.statusStore.save(this._status);
        this._assertActive(generation);
    }
    /**
     * Coalesces one connectivity change into the coordinator cycle.
     * @param {{generation: number, online: boolean}} args - Connectivity event.
     * @returns {void}
     */
    _connectivityChanged({ generation, online }) {
        if (!this._ownsGeneration(generation))
            return;
        this._clearRetryTimer();
        if (online)
            this._attempt = 0;
        void this.trigger(online ? "connectivity-online" : "connectivity-offline");
    }
    /**
     * Clears the currently owned retry timer, if present.
     * @returns {void}
     */
    _clearRetryTimer() {
        if (this._retryTimer === null)
            return;
        this.scheduler.clearTimeout(this._retryTimer);
        this._retryTimer = null;
    }
    /**
     * Checks whether a lifecycle generation still owns state updates.
     * @param {number} generation - Expected generation.
     * @returns {boolean} - Whether the generation is current and active.
     */
    _ownsGeneration(generation) {
        return this._active && this._generation === generation;
    }
    /**
     * Fails when work no longer belongs to the active generation.
     * @param {number} generation - Expected generation.
     * @returns {void}
     */
    _assertActive(generation) {
        if (this._ownsGeneration(generation))
            return;
        throw new SyncCoordinatorLifecycleAbortError("Sync coordinator work belongs to an inactive generation");
    }
    /**
     * Identifies coordinator-owned cooperative cancellation.
     * @param {unknown} error - Candidate error.
     * @returns {boolean} - Whether this coordinator created the abort error.
     */
    isLifecycleAbort(error) {
        return error instanceof SyncCoordinatorLifecycleAbortError;
    }
    /**
     * Reads and validates the injected clock.
     * @returns {string} - Valid ISO clock value.
     */
    _nowIso() {
        const value = this.now();
        if (!(value instanceof Date) || Number.isNaN(value.getTime()))
            throw new Error("SyncCoordinator now() must return a valid Date");
        return value.toISOString();
    }
    /**
     * Freezes and publishes a new observable snapshot.
     * @param {import("./sync-coordinator-types.js").SyncCoordinatorStatus} status - New status.
     * @returns {void}
     */
    _publish(status) {
        this._status = immutableStatus(status);
        for (const listener of this._listeners)
            listener(this._status);
    }
    /**
     * Returns the current observable snapshot.
     * @returns {import("./sync-coordinator-types.js").SyncCoordinatorStatus} - Current immutable snapshot.
     */
    status() {
        return this._status;
    }
    /**
     * Observes status and receives the current snapshot immediately.
     * @param {(status: import("./sync-coordinator-types.js").SyncCoordinatorStatus) => void} listener - Observer.
     * @returns {() => void} - Idempotent unsubscribe.
     */
    subscribe(listener) {
        requireFunction(listener, "status listener");
        this._listeners.add(listener);
        listener(this._status);
        return () => this._listeners.delete(listener);
    }
    /**
     * Awaits only the active or queued cycle, not a future backoff timer.
     * @returns {Promise<void>} - Resolves when current work drains.
     */
    async waitForCurrentRun() {
        while (this._runPromise)
            await this._runPromise;
    }
}
/**
 * Builds the default global timer adapter.
 * @returns {import("./sync-coordinator-types.js").SyncCoordinatorScheduler} - Global timer adapter.
 */
function defaultScheduler() {
    return {
        clearTimeout: (timer) => globalThis.clearTimeout(/** @type {ReturnType<typeof setTimeout>} */ (timer)),
        setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs)
    };
}
/**
 * Validates and fills retry policy defaults.
 * @param {Record<string, number>} retry - Retry overrides.
 * @returns {{initialDelayMs: number, maxAttempts: number, maxDelayMs: number}} - Complete policy.
 */
function normalizeRetryPolicy(retry) {
    const policy = { ...DEFAULT_RETRY, ...retry };
    for (const [name, value] of Object.entries(policy)) {
        if (!Number.isInteger(value) || value < 1)
            throw new Error(`SyncCoordinator retry.${name} must be a positive integer`);
    }
    if (policy.maxDelayMs < policy.initialDelayMs)
        throw new Error("SyncCoordinator retry.maxDelayMs must be greater than or equal to initialDelayMs");
    return policy;
}
/**
 * Classifies unknown errors as permanent without exposing their messages.
 * @param {Error} _error - Unclassified error.
 * @returns {{code: string, retryable: boolean}} - Safe default classification.
 */
function defaultErrorClassification(_error) {
    return { code: "sync_failed", retryable: false };
}
/**
 * Validates application-provided safe error metadata.
 * @param {ReturnType<typeof defaultErrorClassification> & {message?: string}} classification - Raw classification.
 * @returns {{code: string, message?: string, retryable: boolean}} - Validated classification.
 */
function normalizeErrorClassification(classification) {
    if (!classification || typeof classification !== "object" || Array.isArray(classification))
        throw new Error("SyncCoordinator classifyError must return an object");
    if (typeof classification.code !== "string" || classification.code.length === 0)
        throw new Error("SyncCoordinator error classification code must be a non-empty string");
    if (typeof classification.retryable !== "boolean")
        throw new Error("SyncCoordinator error classification retryable must be boolean");
    if (classification.message !== undefined && typeof classification.message !== "string")
        throw new Error("SyncCoordinator error classification message must be a string");
    return classification;
}
/**
 * Builds one failure snapshot and its optional automatic-retry delay.
 * @param {{attempt: number, classified: {code: string, message?: string, retryable: boolean}, failedAt: string, retryPolicy: {initialDelayMs: number, maxAttempts: number, maxDelayMs: number}, status: import("./sync-coordinator-types.js").SyncCoordinatorStatus}} args - Failure state.
 * @returns {{delayMs: number | null, status: import("./sync-coordinator-types.js").SyncCoordinatorStatus}} - Failure snapshot and retry delay.
 */
function failureStatusFor({ attempt, classified, failedAt, retryPolicy, status }) {
    const retryable = classified.retryable && attempt < retryPolicy.maxAttempts;
    const delayMs = retryable ? Math.min(retryPolicy.initialDelayMs * (2 ** (attempt - 1)), retryPolicy.maxDelayMs) : null;
    const failure = {
        attempt,
        at: failedAt,
        code: classified.code,
        ...(classified.message === undefined ? {} : { message: classified.message }),
        retryable: classified.retryable
    };
    const nextRetryAt = delayMs === null ? null : new Date(new Date(failedAt).getTime() + delayMs).toISOString();
    return {
        delayMs,
        status: immutableStatus({ ...status, failure, nextRetryAt, state: retryable ? "backoff" : "failed" })
    };
}
/**
 * Maps durable queue state to an observable resting state.
 * @param {import("./sync-coordinator-types.js").SyncClientInspection} inspection - Durable inspection.
 * @returns {import("./sync-coordinator-types.js").SyncCoordinatorState} - Resting state.
 */
function inspectionState(inspection) {
    if (inspection.conflicts.length > 0)
        return "conflicted";
    if (inspection.rejectedCount > 0)
        return "failed";
    if (inspection.pendingCount > 0)
        return "pending";
    return "idle";
}
/**
 * Removes stale in-flight timing from a restored status snapshot.
 * @param {import("./sync-coordinator-types.js").SyncCoordinatorStatus} status - Stored status.
 * @returns {import("./sync-coordinator-types.js").SyncCoordinatorStatus} - Restored observable status.
 */
function restoredStatus(status) {
    if (!COORDINATOR_STATES.has(status.state))
        throw new Error(`Unknown persisted SyncCoordinator state: ${String(status.state)}`);
    return {
        conflicts: status.conflicts,
        failure: status.failure,
        lastSuccessAt: status.lastSuccessAt,
        nextRetryAt: null,
        pendingCount: status.pendingCount,
        rejectedCount: status.rejectedCount,
        state: status.state === "syncing" || status.state === "backoff" ? inspectionState(status) : status.state
    };
}
/**
 * Deep-freezes the status-owned diagnostic collections.
 * @param {import("./sync-coordinator-types.js").SyncCoordinatorStatus} status - Snapshot.
 * @returns {import("./sync-coordinator-types.js").SyncCoordinatorStatus} - Immutable snapshot.
 */
function immutableStatus(status) {
    const conflicts = status.conflicts.map((conflict) => Object.freeze({ ...conflict }));
    const failure = status.failure ? Object.freeze({ ...status.failure }) : null;
    return Object.freeze({ ...status, conflicts: Object.freeze(conflicts), failure });
}
/**
 * Validates one required callback.
 * @param {unknown} value - Function candidate.
 * @param {string} label - Contract label.
 * @returns {void} - Validates the function candidate.
 */
function requireFunction(value, label) {
    if (typeof value !== "function")
        throw new Error(`SyncCoordinator ${label} must be a function`);
}
/**
 * Validates the SyncClient surface required by the coordinator.
 * @param {import("./sync-client.js").default} client - Client.
 * @returns {void}
 */
function requireCoordinatorClient(client) {
    if (!client)
        throw new Error("SyncCoordinator requires a SyncClient");
    requireFunction(client.attachCoordinator, "syncClient.attachCoordinator");
    requireFunction(client.inspectSyncState, "syncClient.inspectSyncState");
    requireFunction(client.isLifecycleAbort, "syncClient.isLifecycleAbort");
    requireFunction(client.isOnline, "syncClient.isOnline");
    requireFunction(client.pull, "syncClient.pull");
    requireFunction(client.reportError, "syncClient.reportError");
    requireFunction(client.replayPending, "syncClient.replayPending");
    requireFunction(client.resolveConflict, "syncClient.resolveConflict");
    requireFunction(client.start, "syncClient.start");
    requireFunction(client.stop, "syncClient.stop");
    requireFunction(client.subscribeRealtime, "syncClient.subscribeRealtime");
    requireFunction(client.waitForScheduledReplay, "syncClient.waitForScheduledReplay");
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1jb29yZGluYXRvci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9zeW5jL3N5bmMtY29vcmRpbmF0b3IuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sYUFBYSxNQUFNLDZCQUE2QixDQUFBO0FBRXZELE1BQU0sa0JBQWtCLEdBQUcsSUFBSSxHQUFHLENBQUMsQ0FBQyxTQUFTLEVBQUUsWUFBWSxFQUFFLFFBQVEsRUFBRSxNQUFNLEVBQUUsU0FBUyxFQUFFLFNBQVMsRUFBRSxTQUFTLEVBQUUsU0FBUyxDQUFDLENBQUMsQ0FBQTtBQUMzSCxNQUFNLGFBQWEsR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLEVBQUMsY0FBYyxFQUFFLEtBQUssRUFBRSxXQUFXLEVBQUUsQ0FBQyxFQUFFLFVBQVUsRUFBRSxNQUFNLEVBQUMsQ0FBQyxDQUFBO0FBRWhHLDBGQUEwRjtBQUMxRixNQUFNLE9BQU8sa0NBQW1DLFNBQVEsS0FBSztJQUMzRDs7O09BR0c7SUFDSCxZQUFZLE9BQU87UUFDakIsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBQ2QsSUFBSSxDQUFDLElBQUksR0FBRyxvQ0FBb0MsQ0FBQTtJQUNsRCxDQUFDO0NBQ0Y7QUFFRDs7Ozs7R0FLRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sZUFBZTtJQUNsQzs7Ozs7Ozs7Ozs7O09BWUc7SUFDSCxZQUFZLEVBQUMsYUFBYSxHQUFHLDBCQUEwQixFQUFFLFlBQVksRUFBRSxHQUFHLEdBQUcsR0FBRyxFQUFFLENBQUMsSUFBSSxJQUFJLEVBQUUsRUFBRSxPQUFPLEdBQUcsR0FBRyxFQUFFLENBQUMsU0FBUyxFQUFFLFFBQVEsR0FBRyxJQUFJLEVBQUUsS0FBSyxHQUFHLEVBQUUsRUFBRSxTQUFTLEdBQUcsZ0JBQWdCLEVBQUUsRUFBRSxXQUFXLEVBQUUsVUFBVSxFQUFFLEdBQUcsUUFBUSxFQUFDO1FBQzFOLGFBQWEsQ0FBQyxRQUFRLENB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QUFDLFFBQVEsRUFBRSxxQkFBcUIsQ0FBQyxDQUFBO0lBQ3ZELGVBQWUsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLGlCQUFpQixDQUFDLENBQUE7SUFDL0MsZUFBZSxDQUFDLE1BQU0sQ0FBQyxXQUFXLEVBQUUsd0JBQXdCLENBQUMsQ0FBQTtJQUM3RCxlQUFlLENBQUMsTUFBTSxDQUFDLGFBQWEsRUFBRSwwQkFBMEIsQ0FBQyxDQUFBO0lBQ2pFLGVBQWUsQ0FBQyxNQUFNLENBQUMsZUFBZSxFQUFFLDRCQUE0QixDQUFDLENBQUE7SUFDckUsZUFBZSxDQUFDLE1BQU0sQ0FBQyxLQUFLLEVBQUUsa0JBQWtCLENBQUMsQ0FBQTtJQUNqRCxlQUFlLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxpQkFBaUIsQ0FBQyxDQUFBO0lBQy9DLGVBQWUsQ0FBQyxNQUFNLENBQUMsaUJBQWlCLEVBQUUsOEJBQThCLENBQUMsQ0FBQTtJQUN6RSxlQUFlLENBQUMsTUFBTSxDQUFDLHNCQUFzQixFQUFFLG1DQUFtQyxDQUFDLENBQUE7QUFDckYsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi4vdXRpbHMvcmVzdC1hcmdzLWVycm9yLmpzXCJcblxuY29uc3QgQ09PUkRJTkFUT1JfU1RBVEVTID0gbmV3IFNldChbXCJiYWNrb2ZmXCIsIFwiY29uZmxpY3RlZFwiLCBcImZhaWxlZFwiLCBcImlkbGVcIiwgXCJvZmZsaW5lXCIsIFwicGVuZGluZ1wiLCBcInN0b3BwZWRcIiwgXCJzeW5jaW5nXCJdKVxuY29uc3QgREVGQVVMVF9SRVRSWSA9IE9iamVjdC5mcmVlemUoe2luaXRpYWxEZWxheU1zOiAxXzAwMCwgbWF4QXR0ZW1wdHM6IDQsIG1heERlbGF5TXM6IDMwXzAwMH0pXG5cbi8qKiBFeHBlY3RlZCBjb29wZXJhdGl2ZSBjYW5jZWxsYXRpb24gcmFpc2VkIGJ5IGEgU3luY0Nvb3JkaW5hdG9yIGxpZmVjeWNsZSB0cmFuc2l0aW9uLiAqL1xuZXhwb3J0IGNsYXNzIFN5bmNDb29yZGluYXRvckxpZmVjeWNsZUFib3J0RXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgbGlmZWN5Y2xlIGNhbmNlbGxhdGlvbiBlcnJvci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1lc3NhZ2UgLSBDYW5jZWxsYXRpb24gcmVhc29uLlxuICAgKi9cbiAgY29uc3RydWN0b3IobWVzc2FnZSkge1xuICAgIHN1cGVyKG1lc3NhZ2UpXG4gICAgdGhpcy5uYW1lID0gXCJTeW5jQ29vcmRpbmF0b3JMaWZlY3ljbGVBYm9ydEVycm9yXCJcbiAgfVxufVxuXG4vKipcbiAqIFJldXNhYmxlIG9ic2VydmFibGUgbGlmZWN5Y2xlIGFyb3VuZCBTeW5jQ2xpZW50LiBJdCBzZXJpYWxpemVzIHJlcGxheSxcbiAqIHJlYWx0aW1lIHN1YnNjcmlwdGlvbiwgYW5kIHN0YWJsZS1jdXJzb3IgcHVsbCBpbnRvIG9uZSBjeWNsZTsgY29hbGVzY2VzIGFueVxuICogdHJpZ2dlcnMgcmVjZWl2ZWQgZHVyaW5nIHRoYXQgY3ljbGUgaW50byBvbmUgcmVydW47IG93bnMgYm91bmRlZCByZXRyeTsgYW5kXG4gKiBnZW5lcmF0aW9uLWZlbmNlcyBzdGF0dXMgdXBkYXRlcyBhZnRlciBzdG9wL3Jlc3RhcnQuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFN5bmNDb29yZGluYXRvciB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIG9uZSByZXVzYWJsZSBzeW5jIGxpZmVjeWNsZSBvd25lci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBDb29yZGluYXRvciBkZXBlbmRlbmNpZXMuXG4gICAqIEBwYXJhbSB7KGVycm9yOiBFcnJvcikgPT4ge2NvZGU6IHN0cmluZywgbWVzc2FnZT86IHN0cmluZywgcmV0cnlhYmxlOiBib29sZWFufX0gW2FyZ3MuY2xhc3NpZnlFcnJvcl0gLSBNYXBzIGVycm9ycyB0byBzYWZlIHJldHJ5L2Rpc3BsYXkgbWV0YWRhdGEuIERlZmF1bHRzIHRvIHBlcm1hbmVudCBgc3luY19mYWlsZWRgIHdpdGhvdXQgcGVyc2lzdGluZyB0aGUgZXJyb3IgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtY29vcmRpbmF0b3ItdHlwZXMuanNcIikuU3luY0Nvb3JkaW5hdG9yQ29ubmVjdGl2aXR5fSBbYXJncy5jb25uZWN0aXZpdHldIC0gT3B0aW9uYWwgY29ubmVjdGl2aXR5IGV2ZW50IHNvdXJjZS5cbiAgICogQHBhcmFtIHsoKSA9PiBEYXRlfSBbYXJncy5ub3ddIC0gSW5qZWN0ZWQgY2xvY2suXG4gICAqIEBwYXJhbSB7KGFyZ3M6IHtzaWduYWw6IEFib3J0U2lnbmFsLCBzeW5jQ2xpZW50OiBpbXBvcnQoXCIuL3N5bmMtY2xpZW50LmpzXCIpLmRlZmF1bHR9KSA9PiBQcm9taXNlPCgoKSA9PiBQcm9taXNlPHZvaWQ+IHwgdm9pZCkgfCB2b2lkPiB8ICgoKSA9PiBQcm9taXNlPHZvaWQ+IHwgdm9pZCkgfCB2b2lkfSBbYXJncy5wcmVwYXJlXSAtIEFjdGl2YXRlcyBzY29wZXMvYWNxdWlyZXMgYXBwLW93bmVkIHJlc291cmNlcyBiZWZvcmUgdGhlIGZpcnN0IGN5Y2xlIGFuZCByZXR1cm5zIHRoZWlyIHRlYXJkb3duLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLnJlYWx0aW1lXSAtIFdoZXRoZXIgY3ljbGVzIHN1YnNjcmliZSByZWFsdGltZSBiZWZvcmUgcHVsbGluZy4gRGVmYXVsdHMgdG8gdHJ1ZS5cbiAgICogQHBhcmFtIHt7aW5pdGlhbERlbGF5TXM/OiBudW1iZXIsIG1heEF0dGVtcHRzPzogbnVtYmVyLCBtYXhEZWxheU1zPzogbnVtYmVyfX0gW2FyZ3MucmV0cnldIC0gQm91bmRlZCBhdXRvbWF0aWMgcmV0cnkgcG9saWN5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy1jb29yZGluYXRvci10eXBlcy5qc1wiKS5TeW5jQ29vcmRpbmF0b3JTY2hlZHVsZXJ9IFthcmdzLnNjaGVkdWxlcl0gLSBJbmplY3RlZCB0aW1lciBvd25lci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtY29vcmRpbmF0b3ItdHlwZXMuanNcIikuU3luY0Nvb3JkaW5hdG9yU3RhdHVzU3RvcmV9IFthcmdzLnN0YXR1c1N0b3JlXSAtIE9wdGlvbmFsIHByaXZhY3ktc2FmZSBkdXJhYmxlIHN0YXR1cyBzdG9yZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtY2xpZW50LmpzXCIpLmRlZmF1bHR9IGFyZ3Muc3luY0NsaWVudCAtIFN5bmNDbGllbnQgb3duaW5nIHF1ZXVlLCBzY29wZXMsIGN1cnNvcnMsIGFwcGx5LCBhbmQgcmVhbHRpbWUuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y2xhc3NpZnlFcnJvciA9IGRlZmF1bHRFcnJvckNsYXNzaWZpY2F0aW9uLCBjb25uZWN0aXZpdHksIG5vdyA9ICgpID0+IG5ldyBEYXRlKCksIHByZXBhcmUgPSAoKSA9PiB1bmRlZmluZWQsIHJlYWx0aW1lID0gdHJ1ZSwgcmV0cnkgPSB7fSwgc2NoZWR1bGVyID0gZGVmYXVsdFNjaGVkdWxlcigpLCBzdGF0dXNTdG9yZSwgc3luY0NsaWVudCwgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcbiAgICByZXF1aXJlQ29vcmRpbmF0b3JDbGllbnQoc3luY0NsaWVudClcbiAgICByZXF1aXJlRnVuY3Rpb24oY2xhc3NpZnlFcnJvciwgXCJjbGFzc2lmeUVycm9yXCIpXG4gICAgcmVxdWlyZUZ1bmN0aW9uKG5vdywgXCJub3dcIilcbiAgICByZXF1aXJlRnVuY3Rpb24ocHJlcGFyZSwgXCJwcmVwYXJlXCIpXG4gICAgaWYgKHR5cGVvZiByZWFsdGltZSAhPT0gXCJib29sZWFuXCIpIHRocm93IG5ldyBFcnJvcihcIlN5bmNDb29yZGluYXRvciByZWFsdGltZSBtdXN0IGJlIGJvb2xlYW5cIilcbiAgICBpZiAoY29ubmVjdGl2aXR5KSByZXF1aXJlRnVuY3Rpb24oY29ubmVjdGl2aXR5LnN1YnNjcmliZSwgXCJjb25uZWN0aXZpdHkuc3Vic2NyaWJlXCIpXG4gICAgaWYgKHN0YXR1c1N0b3JlKSB7XG4gICAgICByZXF1aXJlRnVuY3Rpb24oc3RhdHVzU3RvcmUubG9hZCwgXCJzdGF0dXNTdG9yZS5sb2FkXCIpXG4gICAgICByZXF1aXJlRnVuY3Rpb24oc3RhdHVzU3RvcmUuc2F2ZSwgXCJzdGF0dXNTdG9yZS5zYXZlXCIpXG4gICAgfVxuICAgIHJlcXVpcmVGdW5jdGlvbihzY2hlZHVsZXIuY2xlYXJUaW1lb3V0LCBcInNjaGVkdWxlci5jbGVhclRpbWVvdXRcIilcbiAgICByZXF1aXJlRnVuY3Rpb24oc2NoZWR1bGVyLnNldFRpbWVvdXQsIFwic2NoZWR1bGVyLnNldFRpbWVvdXRcIilcblxuICAgIHRoaXMuc3luY0NsaWVudCA9IHN5bmNDbGllbnRcbiAgICB0aGlzLmNsYXNzaWZ5RXJyb3IgPSBjbGFzc2lmeUVycm9yXG4gICAgdGhpcy5jb25uZWN0aXZpdHkgPSBjb25uZWN0aXZpdHkgfHwgbnVsbFxuICAgIHRoaXMubm93ID0gbm93XG4gICAgdGhpcy5wcmVwYXJlID0gcHJlcGFyZVxuICAgIHRoaXMucmVhbHRpbWUgPSByZWFsdGltZVxuICAgIHRoaXMucmV0cnlQb2xpY3kgPSBub3JtYWxpemVSZXRyeVBvbGljeShyZXRyeSlcbiAgICB0aGlzLnNjaGVkdWxlciA9IHNjaGVkdWxlclxuICAgIHRoaXMuc3RhdHVzU3RvcmUgPSBzdGF0dXNTdG9yZSB8fCBudWxsXG5cbiAgICB0aGlzLl9hY3RpdmUgPSBmYWxzZVxuICAgIHRoaXMuX2F0dGVtcHQgPSAwXG4gICAgdGhpcy5fZ2VuZXJhdGlvbiA9IDBcbiAgICB0aGlzLl9saWZlY3ljbGVBYm9ydENvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKClcbiAgICAvKiogQHR5cGUge1NldDwoc3RhdHVzOiBpbXBvcnQoXCIuL3N5bmMtY29vcmRpbmF0b3ItdHlwZXMuanNcIikuU3luY0Nvb3JkaW5hdG9yU3RhdHVzKSA9PiB2b2lkPn0gKi9cbiAgICB0aGlzLl9saXN0ZW5lcnMgPSBuZXcgU2V0KClcbiAgICAvKiogQHR5cGUge0FycmF5PCgpID0+IFByb21pc2U8dm9pZD4gfCB2b2lkPn0gKi9cbiAgICB0aGlzLl9saWZlY3ljbGVDbGVhbnVwcyA9IFtdXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgbnVsbH0gKi9cbiAgICB0aGlzLl9ydW5Qcm9taXNlID0gbnVsbFxuICAgIHRoaXMuX3JlcnVuUmVxdWVzdGVkID0gZmFsc2VcbiAgICAvKiogQHR5cGUge3Vua25vd259ICovXG4gICAgdGhpcy5fcmV0cnlUaW1lciA9IG51bGxcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCBudWxsfSAqL1xuICAgIHRoaXMuX3N0YXJ0UHJvbWlzZSA9IG51bGxcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCBudWxsfSAqL1xuICAgIHRoaXMuX3N0b3BQcm9taXNlID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9zeW5jLWNvb3JkaW5hdG9yLXR5cGVzLmpzXCIpLlN5bmNDb29yZGluYXRvclN0YXR1c30gKi9cbiAgICB0aGlzLl9zdGF0dXMgPSBpbW11dGFibGVTdGF0dXMoe1xuICAgICAgY29uZmxpY3RzOiBbXSxcbiAgICAgIGZhaWx1cmU6IG51bGwsXG4gICAgICBsYXN0U3VjY2Vzc0F0OiBudWxsLFxuICAgICAgbmV4dFJldHJ5QXQ6IG51bGwsXG4gICAgICBwZW5kaW5nQ291bnQ6IDAsXG4gICAgICByZWplY3RlZENvdW50OiAwLFxuICAgICAgc3RhdGU6IFwic3RvcHBlZFwiXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnN0YWxscyBsb2NhbCBvd25lcnNoaXAgYW5kIHNjaGVkdWxlcyB0aGUgaW5pdGlhbCBuZXR3b3JrIGN5Y2xlIHdpdGhvdXRcbiAgICogYXdhaXRpbmcgaXQsIHNvIGNhY2hlZCByZWFkcyBuZXZlciBkZXBlbmQgb24gbmV0d29yayBjb21wbGV0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBsb2NhbCBvd25lcnNoaXAgaXMgaW5zdGFsbGVkLlxuICAgKi9cbiAgc3RhcnQoKSB7XG4gICAgaWYgKHRoaXMuX2FjdGl2ZSAmJiAhdGhpcy5fc3RhcnRQcm9taXNlKSByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKClcbiAgICBpZiAodGhpcy5fc3RhcnRQcm9taXNlKSByZXR1cm4gdGhpcy5fc3RhcnRQcm9taXNlXG4gICAgaWYgKHRoaXMuX3N0b3BQcm9taXNlKSByZXR1cm4gdGhpcy5fc3RvcFByb21pc2UudGhlbihhc3luYyAoKSA9PiBhd2FpdCB0aGlzLnN0YXJ0KCkpXG5cbiAgICB0aGlzLl9hY3RpdmUgPSB0cnVlXG4gICAgdGhpcy5fYXR0ZW1wdCA9IDBcbiAgICBjb25zdCBnZW5lcmF0aW9uID0gKyt0aGlzLl9nZW5lcmF0aW9uXG5cbiAgICB0aGlzLl9saWZlY3ljbGVBYm9ydENvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKClcbiAgICB0aGlzLl9zdGFydFByb21pc2UgPSB0aGlzLl9zdGFydChnZW5lcmF0aW9uKS5maW5hbGx5KCgpID0+IHtcbiAgICAgIHRoaXMuX3N0YXJ0UHJvbWlzZSA9IG51bGxcbiAgICB9KVxuXG4gICAgcmV0dXJuIHRoaXMuX3N0YXJ0UHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIFN0YXJ0cyBvbmUgbGlmZWN5Y2xlIGdlbmVyYXRpb24gd2l0aCByb2xsYmFjayBvbiBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge251bWJlcn0gZ2VuZXJhdGlvbiAtIE93bmluZyBnZW5lcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBhY3RpdmF0aW9uIGNvbXBsZXRlcy5cbiAgICovXG4gIGFzeW5jIF9zdGFydChnZW5lcmF0aW9uKSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX2FjdGl2YXRlKGdlbmVyYXRpb24pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmICh0aGlzLmlzTGlmZWN5Y2xlQWJvcnQoZXJyb3IpIHx8ICF0aGlzLl9vd25zR2VuZXJhdGlvbihnZW5lcmF0aW9uKSkgdGhyb3cgZXJyb3JcblxuICAgICAgYXdhaXQgdGhpcy5fcm9sbGJhY2tGYWlsZWRTdGFydCgvKiogQHR5cGUge0Vycm9yfSAqLyAoZXJyb3IpLCBnZW5lcmF0aW9uKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBY3F1aXJlcyBjb29yZGluYXRvciwgY29ubmVjdGl2aXR5LCBjbGllbnQsIGFuZCBhcHBsaWNhdGlvbiByZXNvdXJjZXMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBnZW5lcmF0aW9uIC0gT3duaW5nIGdlbmVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGV2ZXJ5IG93bmVyIGlzIGFjdGl2ZS5cbiAgICovXG4gIGFzeW5jIF9hY3RpdmF0ZShnZW5lcmF0aW9uKSB7XG4gICAgaWYgKHRoaXMuc3RhdHVzU3RvcmUpIHtcbiAgICAgIGNvbnN0IHBlcnNpc3RlZFN0YXR1cyA9IGF3YWl0IHRoaXMuc3RhdHVzU3RvcmUubG9hZCgpXG5cbiAgICAgIHRoaXMuX2Fzc2VydEFjdGl2ZShnZW5lcmF0aW9uKVxuICAgICAgaWYgKHBlcnNpc3RlZFN0YXR1cykgdGhpcy5fcHVibGlzaChyZXN0b3JlZFN0YXR1cyhwZXJzaXN0ZWRTdGF0dXMpKVxuICAgIH1cblxuICAgIGNvbnN0IGRldGFjaENvb3JkaW5hdG9yID0gdGhpcy5zeW5jQ2xpZW50LmF0dGFjaENvb3JkaW5hdG9yKGFzeW5jIChyZWFzb24pID0+IGF3YWl0IHRoaXMudHJpZ2dlcihyZWFzb24pKVxuXG4gICAgdGhpcy5fbGlmZWN5Y2xlQ2xlYW51cHMucHVzaChkZXRhY2hDb29yZGluYXRvcilcblxuICAgIGlmICh0aGlzLmNvbm5lY3Rpdml0eSkge1xuICAgICAgY29uc3QgdW5zdWJzY3JpYmVDb25uZWN0aXZpdHkgPSB0aGlzLmNvbm5lY3Rpdml0eS5zdWJzY3JpYmUoKG9ubGluZSkgPT4gdGhpcy5fY29ubmVjdGl2aXR5Q2hhbmdlZCh7Z2VuZXJhdGlvbiwgb25saW5lfSkpXG5cbiAgICAgIHRoaXMuX2xpZmVjeWNsZUNsZWFudXBzLnB1c2godW5zdWJzY3JpYmVDb25uZWN0aXZpdHkpXG4gICAgfVxuXG4gICAgdGhpcy5fYXNzZXJ0QWN0aXZlKGdlbmVyYXRpb24pXG4gICAgYXdhaXQgdGhpcy5zeW5jQ2xpZW50LnN0YXJ0KClcbiAgICB0aGlzLl9hc3NlcnRBY3RpdmUoZ2VuZXJhdGlvbilcblxuICAgIGNvbnN0IHJlbGVhc2UgPSBhd2FpdCB0aGlzLnByZXBhcmUoe3NpZ25hbDogdGhpcy5fbGlmZWN5Y2xlQWJvcnRDb250cm9sbGVyLnNpZ25hbCwgc3luY0NsaWVudDogdGhpcy5zeW5jQ2xpZW50fSlcblxuICAgIGlmIChyZWxlYXNlICE9PSB1bmRlZmluZWQpIHJlcXVpcmVGdW5jdGlvbihyZWxlYXNlLCBcInByZXBhcmUgdGVhcmRvd25cIilcbiAgICBpZiAoIXRoaXMuX293bnNHZW5lcmF0aW9uKGdlbmVyYXRpb24pKSB7XG4gICAgICBpZiAocmVsZWFzZSkgYXdhaXQgcmVsZWFzZSgpXG4gICAgICB0aHJvdyBuZXcgU3luY0Nvb3JkaW5hdG9yTGlmZWN5Y2xlQWJvcnRFcnJvcihcIlN5bmMgY29vcmRpbmF0b3Igc3RvcHBlZCBkdXJpbmcgcHJlcGFyYXRpb25cIilcbiAgICB9XG4gICAgaWYgKHJlbGVhc2UpIHRoaXMuX2xpZmVjeWNsZUNsZWFudXBzLnB1c2gocmVsZWFzZSlcblxuICAgIHRoaXMuX3JlcnVuUmVxdWVzdGVkID0gdHJ1ZVxuICAgIHZvaWQgdGhpcy5fc3RhcnRSZXF1ZXN0ZWRSdW4oKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbGVhc2VzIGV2ZXJ5IHBhcnRpYWxseSBhY3F1aXJlZCBvd25lciBhZnRlciBhIGZhaWxlZCBzdGFydCwgcHVibGlzaGVzIGFcbiAgICogc2FmZSB0ZXJtaW5hbCBmYWlsdXJlLCBhbmQgcmV0aHJvd3MgdGhlIG9yaWdpbmFsIGVycm9yIChvciBhbiBhZ2dyZWdhdGUgaWZcbiAgICogdGVhcmRvd24gYWxzbyBmYWlsZWQpLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBlcnJvciAtIFN0YXJ0IGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBnZW5lcmF0aW9uIC0gRmFpbGVkIGdlbmVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG5ldmVyPn0gLSBBbHdheXMgcmVqZWN0cyB3aXRoIHRoZSBzdGFydCBvciBhZ2dyZWdhdGUgZXJyb3IuXG4gICAqL1xuICBhc3luYyBfcm9sbGJhY2tGYWlsZWRTdGFydChlcnJvciwgZ2VuZXJhdGlvbikge1xuICAgIHRoaXMuX2FjdGl2ZSA9IGZhbHNlXG4gICAgdGhpcy5fZ2VuZXJhdGlvbiArPSAxXG4gICAgdGhpcy5fbGlmZWN5Y2xlQWJvcnRDb250cm9sbGVyLmFib3J0KG5ldyBTeW5jQ29vcmRpbmF0b3JMaWZlY3ljbGVBYm9ydEVycm9yKFwiU3luYyBjb29yZGluYXRvciBzdGFydCBmYWlsZWRcIikpXG4gICAgdGhpcy5fcmVydW5SZXF1ZXN0ZWQgPSBmYWxzZVxuICAgIHRoaXMuX2NsZWFyUmV0cnlUaW1lcigpXG5cbiAgICAvKiogQHR5cGUge3Vua25vd25bXX0gKi9cbiAgICBjb25zdCB0ZWFyZG93bkVycm9ycyA9IFtdXG4gICAgY29uc3QgY2xlYW51cHMgPSB0aGlzLl9saWZlY3ljbGVDbGVhbnVwcy5zcGxpY2UoMCkucmV2ZXJzZSgpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5zeW5jQ2xpZW50LnN0b3AoKVxuICAgIH0gY2F0Y2ggKHN0b3BFcnJvcikge1xuICAgICAgdGVhcmRvd25FcnJvcnMucHVzaChzdG9wRXJyb3IpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBjbGVhbnVwIG9mIGNsZWFudXBzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBjbGVhbnVwKClcbiAgICAgIH0gY2F0Y2ggKGNsZWFudXBFcnJvcikge1xuICAgICAgICB0ZWFyZG93bkVycm9ycy5wdXNoKGNsZWFudXBFcnJvcilcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBjbGFzc2lmaWVkID0gbm9ybWFsaXplRXJyb3JDbGFzc2lmaWNhdGlvbih0aGlzLmNsYXNzaWZ5RXJyb3IoZXJyb3IpKVxuICAgIGNvbnN0IGZhaWx1cmUgPSB7XG4gICAgICBhdHRlbXB0OiAxLFxuICAgICAgYXQ6IHRoaXMuX25vd0lzbygpLFxuICAgICAgY29kZTogY2xhc3NpZmllZC5jb2RlLFxuICAgICAgLi4uKGNsYXNzaWZpZWQubWVzc2FnZSA9PT0gdW5kZWZpbmVkID8ge30gOiB7bWVzc2FnZTogY2xhc3NpZmllZC5tZXNzYWdlfSksXG4gICAgICByZXRyeWFibGU6IGNsYXNzaWZpZWQucmV0cnlhYmxlXG4gICAgfVxuXG4gICAgdGhpcy5fYXR0ZW1wdCA9IDFcbiAgICB0aGlzLl9wdWJsaXNoKHsuLi50aGlzLl9zdGF0dXMsIGZhaWx1cmUsIG5leHRSZXRyeUF0OiBudWxsLCBzdGF0ZTogXCJmYWlsZWRcIn0pXG5cbiAgICBpZiAodGhpcy5zdGF0dXNTdG9yZSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5zdGF0dXNTdG9yZS5zYXZlKHRoaXMuX3N0YXR1cylcbiAgICAgIH0gY2F0Y2ggKHBlcnNpc3RlbmNlRXJyb3IpIHtcbiAgICAgICAgdGVhcmRvd25FcnJvcnMucHVzaChwZXJzaXN0ZW5jZUVycm9yKVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh0ZWFyZG93bkVycm9ycy5sZW5ndGggPiAwKSB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoW2Vycm9yLCAuLi50ZWFyZG93bkVycm9yc10sIGBTeW5jIGNvb3JkaW5hdG9yIGdlbmVyYXRpb24gJHtnZW5lcmF0aW9ufSBmYWlsZWQgdG8gc3RhcnQgYW5kIHRlYXIgZG93biBjbGVhbmx5YClcblxuICAgIHRocm93IGVycm9yXG4gIH1cblxuICAvKipcbiAgICogU3RvcHMgY3VycmVudCB3b3JrLCBjbGVhcnMgdGltZXJzL2xpc3RlbmVycywgZHJhaW5zIFN5bmNDbGllbnQsIGFuZCByZWxlYXNlc1xuICAgKiBhcHAtb3duZWQgcmVzb3VyY2VzIGV4YWN0bHkgb25jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIGxpZmVjeWNsZSBpcyBmdWxseSBzdG9wcGVkLlxuICAgKi9cbiAgc3RvcCgpIHtcbiAgICBpZiAodGhpcy5fc3RvcFByb21pc2UpIHJldHVybiB0aGlzLl9zdG9wUHJvbWlzZVxuICAgIGlmICghdGhpcy5fYWN0aXZlICYmICF0aGlzLl9zdGFydFByb21pc2UgJiYgIXRoaXMuX3J1blByb21pc2UpIHtcbiAgICAgIGlmICh0aGlzLl9zdGF0dXMuc3RhdGUgIT09IFwic3RvcHBlZFwiKSB0aGlzLl9wdWJsaXNoKHsuLi50aGlzLl9zdGF0dXMsIG5leHRSZXRyeUF0OiBudWxsLCBzdGF0ZTogXCJzdG9wcGVkXCJ9KVxuXG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKClcbiAgICB9XG5cbiAgICB0aGlzLl9hY3RpdmUgPSBmYWxzZVxuICAgIHRoaXMuX2dlbmVyYXRpb24gKz0gMVxuICAgIHRoaXMuX2xpZmVjeWNsZUFib3J0Q29udHJvbGxlci5hYm9ydChuZXcgU3luY0Nvb3JkaW5hdG9yTGlmZWN5Y2xlQWJvcnRFcnJvcihcIlN5bmMgY29vcmRpbmF0b3Igd2FzIHN0b3BwZWRcIikpXG4gICAgdGhpcy5fcmVydW5SZXF1ZXN0ZWQgPSBmYWxzZVxuICAgIHRoaXMuX2NsZWFyUmV0cnlUaW1lcigpXG5cbiAgICBjb25zdCBjbGVhbnVwcyA9IHRoaXMuX2xpZmVjeWNsZUNsZWFudXBzLnNwbGljZSgwKS5yZXZlcnNlKClcbiAgICBjb25zdCBzdGFydFByb21pc2UgPSB0aGlzLl9zdGFydFByb21pc2VcbiAgICBjb25zdCBydW5Qcm9taXNlID0gdGhpcy5fcnVuUHJvbWlzZVxuXG4gICAgdGhpcy5fc3RvcFByb21pc2UgPSB0aGlzLl9zdG9wKHtjbGVhbnVwcywgcnVuUHJvbWlzZSwgc3RhcnRQcm9taXNlfSkuZmluYWxseSgoKSA9PiB7XG4gICAgICB0aGlzLl9zdG9wUHJvbWlzZSA9IG51bGxcbiAgICB9KVxuXG4gICAgcmV0dXJuIHRoaXMuX3N0b3BQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogRHJhaW5zIGNhcHR1cmVkIGxpZmVjeWNsZSByZXNvdXJjZXMgYWZ0ZXIgYSBzdG9wIHRyYW5zaXRpb24uXG4gICAqIEBwYXJhbSB7e2NsZWFudXBzOiBBcnJheTwoKSA9PiBQcm9taXNlPHZvaWQ+IHwgdm9pZD4sIHJ1blByb21pc2U6IFByb21pc2U8dm9pZD4gfCBudWxsLCBzdGFydFByb21pc2U6IFByb21pc2U8dm9pZD4gfCBudWxsfX0gYXJncyAtIENhcHR1cmVkIGdlbmVyYXRpb24gcmVzb3VyY2VzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0ZWFyZG93biBjb21wbGV0ZXMuXG4gICAqL1xuICBhc3luYyBfc3RvcCh7Y2xlYW51cHMsIHJ1blByb21pc2UsIHN0YXJ0UHJvbWlzZX0pIHtcbiAgICAvKiogQHR5cGUge3Vua25vd25bXX0gKi9cbiAgICBjb25zdCBlcnJvcnMgPSBbXVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuc3luY0NsaWVudC5zdG9wKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgZXJyb3JzLnB1c2goZXJyb3IpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBwcm9taXNlIG9mIFtzdGFydFByb21pc2UsIHJ1blByb21pc2VdKSB7XG4gICAgICBpZiAoIXByb21pc2UpIGNvbnRpbnVlXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHByb21pc2VcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmICghdGhpcy5pc0xpZmVjeWNsZUFib3J0KGVycm9yKSkgZXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICB9XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBjbGVhbnVwIG9mIGNsZWFudXBzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBjbGVhbnVwKClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGVycm9ycy5wdXNoKGVycm9yKVxuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuX2F0dGVtcHQgPSAwXG4gICAgdGhpcy5fcHVibGlzaCh7Li4udGhpcy5fc3RhdHVzLCBmYWlsdXJlOiBudWxsLCBuZXh0UmV0cnlBdDogbnVsbCwgc3RhdGU6IFwic3RvcHBlZFwifSlcblxuICAgIGlmIChlcnJvcnMubGVuZ3RoID09PSAxKSB0aHJvdyBlcnJvcnNbMF1cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDEpIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihlcnJvcnMsIFwiU3luYyBjb29yZGluYXRvciB0ZWFyZG93biBmYWlsZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXF1ZXN0cyBhIGN5Y2xlLiBPdmVybGFwcGluZyByZXF1ZXN0cyBzaGFyZSB0aGUgYWN0aXZlIGZsaWdodCBhbmQgcHJvZHVjZVxuICAgKiBhdCBtb3N0IG9uZSBxdWV1ZWQgcmVydW4uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbcmVhc29uXSAtIERpYWdub3N0aWMgdHJpZ2dlciBsYWJlbCAobmV2ZXIgcGVyc2lzdGVkKS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIGN1cnJlbnQgb3IgcXVldWVkIGN5Y2xlIGRyYWlucy5cbiAgICovXG4gIHRyaWdnZXIocmVhc29uID0gXCJtYW51YWxcIikge1xuICAgIHZvaWQgcmVhc29uXG4gICAgaWYgKCF0aGlzLl9hY3RpdmUpIHJldHVybiBQcm9taXNlLnJlc29sdmUoKVxuXG4gICAgdGhpcy5fcmVydW5SZXF1ZXN0ZWQgPSB0cnVlXG4gICAgaWYgKHRoaXMuX3N0YXJ0UHJvbWlzZSkge1xuICAgICAgcmV0dXJuIHRoaXMuX3N0YXJ0UHJvbWlzZS50aGVuKFxuICAgICAgICBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLl9zdGFydFJlcXVlc3RlZFJ1bigpLFxuICAgICAgICAoKSA9PiB1bmRlZmluZWRcbiAgICAgIClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fc3RhcnRSZXF1ZXN0ZWRSdW4oKVxuICB9XG5cbiAgLyoqXG4gICAqIFN0YXJ0cyByZXF1ZXN0ZWQgd29yayBvbmx5IGFmdGVyIGxpZmVjeWNsZSBwcmVwYXJhdGlvbiBoYXMgY29tcGxldGVkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBDdXJyZW50IG9yIG5ld2x5IHN0YXJ0ZWQgY29vcmRpbmF0b3IgZmxpZ2h0LlxuICAgKi9cbiAgX3N0YXJ0UmVxdWVzdGVkUnVuKCkge1xuICAgIGlmICghdGhpcy5fYWN0aXZlKSByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKClcbiAgICBpZiAodGhpcy5fcmV0cnlUaW1lciAhPT0gbnVsbCkgcmV0dXJuIHRoaXMuX3J1blByb21pc2UgfHwgUHJvbWlzZS5yZXNvbHZlKClcbiAgICBpZiAoIXRoaXMuX3J1blByb21pc2UpIHtcbiAgICAgIGNvbnN0IGdlbmVyYXRpb24gPSB0aGlzLl9nZW5lcmF0aW9uXG5cbiAgICAgIHRoaXMuX3J1blByb21pc2UgPSB0aGlzLl9kcmFpbihnZW5lcmF0aW9uKS5maW5hbGx5KCgpID0+IHtcbiAgICAgICAgdGhpcy5fcnVuUHJvbWlzZSA9IG51bGxcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX3J1blByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhcnMgYmFja29mZiBhbmQgcmVxdWVzdHMgb25lIHNpbmdsZS1mbGlnaHQgdXNlciByZXRyeS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHJldHJ5IGN5Y2xlIGRyYWlucy5cbiAgICovXG4gIHJldHJ5KCkge1xuICAgIGlmICghdGhpcy5fYWN0aXZlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgcmV0cnkgYSBzdG9wcGVkIFN5bmNDb29yZGluYXRvclwiKVxuXG4gICAgdGhpcy5fY2xlYXJSZXRyeVRpbWVyKClcbiAgICB0aGlzLl9hdHRlbXB0ID0gMFxuXG4gICAgcmV0dXJuIHRoaXMudHJpZ2dlcihcIm1hbnVhbC1yZXRyeVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIG9uZSBkdXJhYmxlIGNvbmZsaWN0IHRocm91Z2ggU3luY0NsaWVudCwgdGhlbiByZWZyZXNoZXMgc3RhdHVzIGFuZFxuICAgKiByZXBsYXlzIHJldHJ5LWxvY2FsIGludGVudCB0aHJvdWdoIHRoZSBzYW1lIGN5Y2xlLlxuICAgKiBAcGFyYW0ge3tyZWNvcmRJZDogc3RyaW5nLCByZXNvbHV0aW9uOiBcImtlZXAtc2VydmVyXCIgfCBcInJldHJ5LWxvY2FsXCIsIHJlc291cmNlVHlwZTogc3RyaW5nfX0gYXJncyAtIEV4cGxpY2l0IHJlc29sdXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHJlc29sdXRpb24gc3RhdGUgaXMgcmVmcmVzaGVkLlxuICAgKi9cbiAgYXN5bmMgcmVzb2x2ZUNvbmZsaWN0KGFyZ3MpIHtcbiAgICBpZiAoIXRoaXMuX2FjdGl2ZSkgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IHJlc29sdmUgYSBjb25mbGljdCBvbiBhIHN0b3BwZWQgU3luY0Nvb3JkaW5hdG9yXCIpXG5cbiAgICBhd2FpdCB0aGlzLnN5bmNDbGllbnQucmVzb2x2ZUNvbmZsaWN0KGFyZ3MpXG4gICAgdGhpcy5fY2xlYXJSZXRyeVRpbWVyKClcbiAgICB0aGlzLl9hdHRlbXB0ID0gMFxuICAgIGlmIChhcmdzLnJlc29sdXRpb24gPT09IFwicmV0cnktbG9jYWxcIikge1xuICAgICAgYXdhaXQgdGhpcy5zeW5jQ2xpZW50LndhaXRGb3JTY2hlZHVsZWRSZXBsYXkoKVxuICAgIH0gZWxzZSB7XG4gICAgICBhd2FpdCB0aGlzLnRyaWdnZXIoXCJjb25mbGljdC1yZXNvbHV0aW9uXCIpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIERyYWlucyByZXF1ZXN0ZWQgd29yayBzZXJpYWxseSBmb3Igb25lIGxpZmVjeWNsZSBnZW5lcmF0aW9uLlxuICAgKiBAcGFyYW0ge251bWJlcn0gZ2VuZXJhdGlvbiAtIE93bmluZyBnZW5lcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIG5vIGltbWVkaWF0ZSByZXJ1biByZW1haW5zLlxuICAgKi9cbiAgYXN5bmMgX2RyYWluKGdlbmVyYXRpb24pIHtcbiAgICB3aGlsZSAodGhpcy5fcmVydW5SZXF1ZXN0ZWQgJiYgdGhpcy5fb3duc0dlbmVyYXRpb24oZ2VuZXJhdGlvbikpIHtcbiAgICAgIHRoaXMuX3JlcnVuUmVxdWVzdGVkID0gZmFsc2VcbiAgICAgIGNvbnN0IGNvbXBsZXRlZCA9IGF3YWl0IHRoaXMuX3J1bkN5Y2xlKGdlbmVyYXRpb24pXG5cbiAgICAgIGlmICghY29tcGxldGVkKSB0aGlzLl9yZXJ1blJlcXVlc3RlZCA9IGZhbHNlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb25lIHJlcGxheSwgcmVhbHRpbWUtc3Vic2NyaWJlLCBhbmQgcHVsbCBjeWNsZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGdlbmVyYXRpb24gLSBPd25pbmcgZ2VuZXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBhbiBpbW1lZGlhdGUgcXVldWVkIHJlcnVuIG1heSBwcm9jZWVkLlxuICAgKi9cbiAgYXN5bmMgX3J1bkN5Y2xlKGdlbmVyYXRpb24pIHtcbiAgICB0cnkge1xuICAgICAgY29uc3Qgb25saW5lID0gYXdhaXQgdGhpcy5zeW5jQ2xpZW50LmlzT25saW5lKClcblxuICAgICAgdGhpcy5fYXNzZXJ0QWN0aXZlKGdlbmVyYXRpb24pXG4gICAgICBpZiAoIW9ubGluZSkge1xuICAgICAgICBjb25zdCBpbnNwZWN0aW9uID0gYXdhaXQgdGhpcy5zeW5jQ2xpZW50Lmluc3BlY3RTeW5jU3RhdGUoKVxuXG4gICAgICAgIHRoaXMuX2Fzc2VydEFjdGl2ZShnZW5lcmF0aW9uKVxuICAgICAgICB0aGlzLl9wdWJsaXNoKHsuLi50aGlzLl9zdGF0dXMsIC4uLmluc3BlY3Rpb24sIGZhaWx1cmU6IG51bGwsIG5leHRSZXRyeUF0OiBudWxsLCBzdGF0ZTogXCJvZmZsaW5lXCJ9KVxuICAgICAgICBhd2FpdCB0aGlzLl9wZXJzaXN0U3RhdHVzKGdlbmVyYXRpb24pXG5cbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG5cbiAgICAgIHRoaXMuX3B1Ymxpc2goey4uLnRoaXMuX3N0YXR1cywgbmV4dFJldHJ5QXQ6IG51bGwsIHN0YXRlOiBcInN5bmNpbmdcIn0pXG4gICAgICBhd2FpdCB0aGlzLnN5bmNDbGllbnQucmVwbGF5UGVuZGluZygpXG4gICAgICB0aGlzLl9hc3NlcnRBY3RpdmUoZ2VuZXJhdGlvbilcbiAgICAgIGlmICh0aGlzLnJlYWx0aW1lKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuc3luY0NsaWVudC5zdWJzY3JpYmVSZWFsdGltZSgpXG4gICAgICAgIHRoaXMuX2Fzc2VydEFjdGl2ZShnZW5lcmF0aW9uKVxuICAgICAgfVxuICAgICAgYXdhaXQgdGhpcy5zeW5jQ2xpZW50LnB1bGwoKVxuICAgICAgdGhpcy5fYXNzZXJ0QWN0aXZlKGdlbmVyYXRpb24pXG5cbiAgICAgIGNvbnN0IGluc3BlY3Rpb24gPSBhd2FpdCB0aGlzLnN5bmNDbGllbnQuaW5zcGVjdFN5bmNTdGF0ZSgpXG5cbiAgICAgIHRoaXMuX2Fzc2VydEFjdGl2ZShnZW5lcmF0aW9uKVxuICAgICAgdGhpcy5fcHVibGlzaCh7XG4gICAgICAgIC4uLnRoaXMuX3N0YXR1cyxcbiAgICAgICAgLi4uaW5zcGVjdGlvbixcbiAgICAgICAgZmFpbHVyZTogbnVsbCxcbiAgICAgICAgbGFzdFN1Y2Nlc3NBdDogdGhpcy5fbm93SXNvKCksXG4gICAgICAgIG5leHRSZXRyeUF0OiBudWxsLFxuICAgICAgICBzdGF0ZTogaW5zcGVjdGlvblN0YXRlKGluc3BlY3Rpb24pXG4gICAgICB9KVxuICAgICAgYXdhaXQgdGhpcy5fcGVyc2lzdFN0YXR1cyhnZW5lcmF0aW9uKVxuICAgICAgdGhpcy5fYXR0ZW1wdCA9IDBcblxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKCF0aGlzLl9vd25zR2VuZXJhdGlvbihnZW5lcmF0aW9uKSB8fCB0aGlzLmlzTGlmZWN5Y2xlQWJvcnQoZXJyb3IpIHx8IHRoaXMuc3luY0NsaWVudC5pc0xpZmVjeWNsZUFib3J0KGVycm9yKSkgcmV0dXJuIGZhbHNlXG5cbiAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZUZhaWx1cmUoLyoqIEB0eXBlIHtFcnJvcn0gKi8gKGVycm9yKSwgZ2VuZXJhdGlvbilcblxuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFB1Ymxpc2hlcyBhIGNsYXNzaWZpZWQgZmFpbHVyZSBhbmQgb3ducyBpdHMgYm91bmRlZCByZXRyeSB0aW1lci5cbiAgICogQHBhcmFtIHtFcnJvcn0gZXJyb3IgLSBDeWNsZSBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge251bWJlcn0gZ2VuZXJhdGlvbiAtIE93bmluZyBnZW5lcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBzdGF0dXMgcGVyc2lzdGVuY2UgYW5kIHNjaGVkdWxpbmcuXG4gICAqL1xuICBhc3luYyBfaGFuZGxlRmFpbHVyZShlcnJvciwgZ2VuZXJhdGlvbikge1xuICAgIHRoaXMuX2F0dGVtcHQgKz0gMVxuICAgIGxldCBjbGFzc2lmaWVkID0gbm9ybWFsaXplRXJyb3JDbGFzc2lmaWNhdGlvbih0aGlzLmNsYXNzaWZ5RXJyb3IoZXJyb3IpKVxuICAgIGNvbnN0IGZhaWxlZEF0ID0gdGhpcy5fbm93SXNvKClcbiAgICBsZXQgZmFpbHVyZVN0YXR1cyA9IGZhaWx1cmVTdGF0dXNGb3Ioe2F0dGVtcHQ6IHRoaXMuX2F0dGVtcHQsIGNsYXNzaWZpZWQsIGZhaWxlZEF0LCByZXRyeVBvbGljeTogdGhpcy5yZXRyeVBvbGljeSwgc3RhdHVzOiB0aGlzLl9zdGF0dXN9KVxuXG4gICAgdGhpcy5fcHVibGlzaChmYWlsdXJlU3RhdHVzLnN0YXR1cylcblxuICAgIGlmICh0aGlzLnN0YXR1c1N0b3JlKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLnN0YXR1c1N0b3JlLnNhdmUodGhpcy5fc3RhdHVzKVxuICAgICAgICB0aGlzLl9hc3NlcnRBY3RpdmUoZ2VuZXJhdGlvbilcbiAgICAgIH0gY2F0Y2ggKHBlcnNpc3RlbmNlRXJyb3IpIHtcbiAgICAgICAgdGhpcy5fYXNzZXJ0QWN0aXZlKGdlbmVyYXRpb24pXG4gICAgICAgIGNsYXNzaWZpZWQgPSBub3JtYWxpemVFcnJvckNsYXNzaWZpY2F0aW9uKHRoaXMuY2xhc3NpZnlFcnJvcigvKiogQHR5cGUge0Vycm9yfSAqLyAocGVyc2lzdGVuY2VFcnJvcikpKVxuICAgICAgICBmYWlsdXJlU3RhdHVzID0gZmFpbHVyZVN0YXR1c0Zvcih7YXR0ZW1wdDogdGhpcy5fYXR0ZW1wdCwgY2xhc3NpZmllZCwgZmFpbGVkQXQsIHJldHJ5UG9saWN5OiB0aGlzLnJldHJ5UG9saWN5LCBzdGF0dXM6IHRoaXMuX3N0YXR1c30pXG4gICAgICAgIHRoaXMuX3B1Ymxpc2goZmFpbHVyZVN0YXR1cy5zdGF0dXMpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGZhaWx1cmVTdGF0dXMuZGVsYXlNcyAhPT0gbnVsbCkge1xuICAgICAgdGhpcy5fYXNzZXJ0QWN0aXZlKGdlbmVyYXRpb24pXG4gICAgICB0aGlzLl9yZXRyeVRpbWVyID0gdGhpcy5zY2hlZHVsZXIuc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIHRoaXMuX3JldHJ5VGltZXIgPSBudWxsXG4gICAgICAgIGlmICghdGhpcy5fb3duc0dlbmVyYXRpb24oZ2VuZXJhdGlvbikpIHJldHVyblxuXG4gICAgICAgIHZvaWQgdGhpcy50cmlnZ2VyKFwiYXV0b21hdGljLXJldHJ5XCIpXG4gICAgICB9LCBmYWlsdXJlU3RhdHVzLmRlbGF5TXMpXG4gICAgfVxuXG4gICAgdGhpcy5zeW5jQ2xpZW50LnJlcG9ydEVycm9yKGVycm9yKVxuICB9XG5cbiAgLyoqXG4gICAqIFBlcnNpc3RzIHRoZSBjdXJyZW50IHNhZmUgc3RhdHVzIGZvciBhbiBhY3RpdmUgZ2VuZXJhdGlvbi5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGdlbmVyYXRpb24gLSBPd25pbmcgZ2VuZXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcGVyc2lzdGVuY2UuXG4gICAqL1xuICBhc3luYyBfcGVyc2lzdFN0YXR1cyhnZW5lcmF0aW9uKSB7XG4gICAgaWYgKHRoaXMuc3RhdHVzU3RvcmUpIGF3YWl0IHRoaXMuc3RhdHVzU3RvcmUuc2F2ZSh0aGlzLl9zdGF0dXMpXG4gICAgdGhpcy5fYXNzZXJ0QWN0aXZlKGdlbmVyYXRpb24pXG4gIH1cblxuICAvKipcbiAgICogQ29hbGVzY2VzIG9uZSBjb25uZWN0aXZpdHkgY2hhbmdlIGludG8gdGhlIGNvb3JkaW5hdG9yIGN5Y2xlLlxuICAgKiBAcGFyYW0ge3tnZW5lcmF0aW9uOiBudW1iZXIsIG9ubGluZTogYm9vbGVhbn19IGFyZ3MgLSBDb25uZWN0aXZpdHkgZXZlbnQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2Nvbm5lY3Rpdml0eUNoYW5nZWQoe2dlbmVyYXRpb24sIG9ubGluZX0pIHtcbiAgICBpZiAoIXRoaXMuX293bnNHZW5lcmF0aW9uKGdlbmVyYXRpb24pKSByZXR1cm5cblxuICAgIHRoaXMuX2NsZWFyUmV0cnlUaW1lcigpXG4gICAgaWYgKG9ubGluZSkgdGhpcy5fYXR0ZW1wdCA9IDBcbiAgICB2b2lkIHRoaXMudHJpZ2dlcihvbmxpbmUgPyBcImNvbm5lY3Rpdml0eS1vbmxpbmVcIiA6IFwiY29ubmVjdGl2aXR5LW9mZmxpbmVcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhcnMgdGhlIGN1cnJlbnRseSBvd25lZCByZXRyeSB0aW1lciwgaWYgcHJlc2VudC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfY2xlYXJSZXRyeVRpbWVyKCkge1xuICAgIGlmICh0aGlzLl9yZXRyeVRpbWVyID09PSBudWxsKSByZXR1cm5cblxuICAgIHRoaXMuc2NoZWR1bGVyLmNsZWFyVGltZW91dCh0aGlzLl9yZXRyeVRpbWVyKVxuICAgIHRoaXMuX3JldHJ5VGltZXIgPSBudWxsXG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIHdoZXRoZXIgYSBsaWZlY3ljbGUgZ2VuZXJhdGlvbiBzdGlsbCBvd25zIHN0YXRlIHVwZGF0ZXMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBnZW5lcmF0aW9uIC0gRXhwZWN0ZWQgZ2VuZXJhdGlvbi5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgZ2VuZXJhdGlvbiBpcyBjdXJyZW50IGFuZCBhY3RpdmUuXG4gICAqL1xuICBfb3duc0dlbmVyYXRpb24oZ2VuZXJhdGlvbikge1xuICAgIHJldHVybiB0aGlzLl9hY3RpdmUgJiYgdGhpcy5fZ2VuZXJhdGlvbiA9PT0gZ2VuZXJhdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIEZhaWxzIHdoZW4gd29yayBubyBsb25nZXIgYmVsb25ncyB0byB0aGUgYWN0aXZlIGdlbmVyYXRpb24uXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBnZW5lcmF0aW9uIC0gRXhwZWN0ZWQgZ2VuZXJhdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfYXNzZXJ0QWN0aXZlKGdlbmVyYXRpb24pIHtcbiAgICBpZiAodGhpcy5fb3duc0dlbmVyYXRpb24oZ2VuZXJhdGlvbikpIHJldHVyblxuXG4gICAgdGhyb3cgbmV3IFN5bmNDb29yZGluYXRvckxpZmVjeWNsZUFib3J0RXJyb3IoXCJTeW5jIGNvb3JkaW5hdG9yIHdvcmsgYmVsb25ncyB0byBhbiBpbmFjdGl2ZSBnZW5lcmF0aW9uXCIpXG4gIH1cblxuICAvKipcbiAgICogSWRlbnRpZmllcyBjb29yZGluYXRvci1vd25lZCBjb29wZXJhdGl2ZSBjYW5jZWxsYXRpb24uXG4gICAqIEBwYXJhbSB7dW5rbm93bn0gZXJyb3IgLSBDYW5kaWRhdGUgZXJyb3IuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhpcyBjb29yZGluYXRvciBjcmVhdGVkIHRoZSBhYm9ydCBlcnJvci5cbiAgICovXG4gIGlzTGlmZWN5Y2xlQWJvcnQoZXJyb3IpIHtcbiAgICByZXR1cm4gZXJyb3IgaW5zdGFuY2VvZiBTeW5jQ29vcmRpbmF0b3JMaWZlY3ljbGVBYm9ydEVycm9yXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgYW5kIHZhbGlkYXRlcyB0aGUgaW5qZWN0ZWQgY2xvY2suXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVmFsaWQgSVNPIGNsb2NrIHZhbHVlLlxuICAgKi9cbiAgX25vd0lzbygpIHtcbiAgICBjb25zdCB2YWx1ZSA9IHRoaXMubm93KClcblxuICAgIGlmICghKHZhbHVlIGluc3RhbmNlb2YgRGF0ZSkgfHwgTnVtYmVyLmlzTmFOKHZhbHVlLmdldFRpbWUoKSkpIHRocm93IG5ldyBFcnJvcihcIlN5bmNDb29yZGluYXRvciBub3coKSBtdXN0IHJldHVybiBhIHZhbGlkIERhdGVcIilcblxuICAgIHJldHVybiB2YWx1ZS50b0lTT1N0cmluZygpXG4gIH1cblxuICAvKipcbiAgICogRnJlZXplcyBhbmQgcHVibGlzaGVzIGEgbmV3IG9ic2VydmFibGUgc25hcHNob3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jLWNvb3JkaW5hdG9yLXR5cGVzLmpzXCIpLlN5bmNDb29yZGluYXRvclN0YXR1c30gc3RhdHVzIC0gTmV3IHN0YXR1cy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcHVibGlzaChzdGF0dXMpIHtcbiAgICB0aGlzLl9zdGF0dXMgPSBpbW11dGFibGVTdGF0dXMoc3RhdHVzKVxuXG4gICAgZm9yIChjb25zdCBsaXN0ZW5lciBvZiB0aGlzLl9saXN0ZW5lcnMpIGxpc3RlbmVyKHRoaXMuX3N0YXR1cylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBjdXJyZW50IG9ic2VydmFibGUgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3N5bmMtY29vcmRpbmF0b3ItdHlwZXMuanNcIikuU3luY0Nvb3JkaW5hdG9yU3RhdHVzfSAtIEN1cnJlbnQgaW1tdXRhYmxlIHNuYXBzaG90LlxuICAgKi9cbiAgc3RhdHVzKCkge1xuICAgIHJldHVybiB0aGlzLl9zdGF0dXNcbiAgfVxuXG4gIC8qKlxuICAgKiBPYnNlcnZlcyBzdGF0dXMgYW5kIHJlY2VpdmVzIHRoZSBjdXJyZW50IHNuYXBzaG90IGltbWVkaWF0ZWx5LlxuICAgKiBAcGFyYW0geyhzdGF0dXM6IGltcG9ydChcIi4vc3luYy1jb29yZGluYXRvci10eXBlcy5qc1wiKS5TeW5jQ29vcmRpbmF0b3JTdGF0dXMpID0+IHZvaWR9IGxpc3RlbmVyIC0gT2JzZXJ2ZXIuXG4gICAqIEByZXR1cm5zIHsoKSA9PiB2b2lkfSAtIElkZW1wb3RlbnQgdW5zdWJzY3JpYmUuXG4gICAqL1xuICBzdWJzY3JpYmUobGlzdGVuZXIpIHtcbiAgICByZXF1aXJlRnVuY3Rpb24obGlzdGVuZXIsIFwic3RhdHVzIGxpc3RlbmVyXCIpXG4gICAgdGhpcy5fbGlzdGVuZXJzLmFkZChsaXN0ZW5lcilcbiAgICBsaXN0ZW5lcih0aGlzLl9zdGF0dXMpXG5cbiAgICByZXR1cm4gKCkgPT4gdGhpcy5fbGlzdGVuZXJzLmRlbGV0ZShsaXN0ZW5lcilcbiAgfVxuXG4gIC8qKlxuICAgKiBBd2FpdHMgb25seSB0aGUgYWN0aXZlIG9yIHF1ZXVlZCBjeWNsZSwgbm90IGEgZnV0dXJlIGJhY2tvZmYgdGltZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY3VycmVudCB3b3JrIGRyYWlucy5cbiAgICovXG4gIGFzeW5jIHdhaXRGb3JDdXJyZW50UnVuKCkge1xuICAgIHdoaWxlICh0aGlzLl9ydW5Qcm9taXNlKSBhd2FpdCB0aGlzLl9ydW5Qcm9taXNlXG4gIH1cbn1cblxuLyoqXG4gKiBCdWlsZHMgdGhlIGRlZmF1bHQgZ2xvYmFsIHRpbWVyIGFkYXB0ZXIuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9zeW5jLWNvb3JkaW5hdG9yLXR5cGVzLmpzXCIpLlN5bmNDb29yZGluYXRvclNjaGVkdWxlcn0gLSBHbG9iYWwgdGltZXIgYWRhcHRlci5cbiAqL1xuZnVuY3Rpb24gZGVmYXVsdFNjaGVkdWxlcigpIHtcbiAgcmV0dXJuIHtcbiAgICBjbGVhclRpbWVvdXQ6ICh0aW1lcikgPT4gZ2xvYmFsVGhpcy5jbGVhclRpbWVvdXQoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0Pn0gKi8gKHRpbWVyKSksXG4gICAgc2V0VGltZW91dDogKGNhbGxiYWNrLCBkZWxheU1zKSA9PiBnbG9iYWxUaGlzLnNldFRpbWVvdXQoY2FsbGJhY2ssIGRlbGF5TXMpXG4gIH1cbn1cblxuLyoqXG4gKiBWYWxpZGF0ZXMgYW5kIGZpbGxzIHJldHJ5IHBvbGljeSBkZWZhdWx0cy5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gcmV0cnkgLSBSZXRyeSBvdmVycmlkZXMuXG4gKiBAcmV0dXJucyB7e2luaXRpYWxEZWxheU1zOiBudW1iZXIsIG1heEF0dGVtcHRzOiBudW1iZXIsIG1heERlbGF5TXM6IG51bWJlcn19IC0gQ29tcGxldGUgcG9saWN5LlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVSZXRyeVBvbGljeShyZXRyeSkge1xuICBjb25zdCBwb2xpY3kgPSB7Li4uREVGQVVMVF9SRVRSWSwgLi4ucmV0cnl9XG5cbiAgZm9yIChjb25zdCBbbmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHBvbGljeSkpIHtcbiAgICBpZiAoIU51bWJlci5pc0ludGVnZXIodmFsdWUpIHx8IHZhbHVlIDwgMSkgdGhyb3cgbmV3IEVycm9yKGBTeW5jQ29vcmRpbmF0b3IgcmV0cnkuJHtuYW1lfSBtdXN0IGJlIGEgcG9zaXRpdmUgaW50ZWdlcmApXG4gIH1cbiAgaWYgKHBvbGljeS5tYXhEZWxheU1zIDwgcG9saWN5LmluaXRpYWxEZWxheU1zKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ29vcmRpbmF0b3IgcmV0cnkubWF4RGVsYXlNcyBtdXN0IGJlIGdyZWF0ZXIgdGhhbiBvciBlcXVhbCB0byBpbml0aWFsRGVsYXlNc1wiKVxuXG4gIHJldHVybiBwb2xpY3lcbn1cblxuLyoqXG4gKiBDbGFzc2lmaWVzIHVua25vd24gZXJyb3JzIGFzIHBlcm1hbmVudCB3aXRob3V0IGV4cG9zaW5nIHRoZWlyIG1lc3NhZ2VzLlxuICogQHBhcmFtIHtFcnJvcn0gX2Vycm9yIC0gVW5jbGFzc2lmaWVkIGVycm9yLlxuICogQHJldHVybnMge3tjb2RlOiBzdHJpbmcsIHJldHJ5YWJsZTogYm9vbGVhbn19IC0gU2FmZSBkZWZhdWx0IGNsYXNzaWZpY2F0aW9uLlxuICovXG5mdW5jdGlvbiBkZWZhdWx0RXJyb3JDbGFzc2lmaWNhdGlvbihfZXJyb3IpIHtcbiAgcmV0dXJuIHtjb2RlOiBcInN5bmNfZmFpbGVkXCIsIHJldHJ5YWJsZTogZmFsc2V9XG59XG5cbi8qKlxuICogVmFsaWRhdGVzIGFwcGxpY2F0aW9uLXByb3ZpZGVkIHNhZmUgZXJyb3IgbWV0YWRhdGEuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIGRlZmF1bHRFcnJvckNsYXNzaWZpY2F0aW9uPiAmIHttZXNzYWdlPzogc3RyaW5nfX0gY2xhc3NpZmljYXRpb24gLSBSYXcgY2xhc3NpZmljYXRpb24uXG4gKiBAcmV0dXJucyB7e2NvZGU6IHN0cmluZywgbWVzc2FnZT86IHN0cmluZywgcmV0cnlhYmxlOiBib29sZWFufX0gLSBWYWxpZGF0ZWQgY2xhc3NpZmljYXRpb24uXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUVycm9yQ2xhc3NpZmljYXRpb24oY2xhc3NpZmljYXRpb24pIHtcbiAgaWYgKCFjbGFzc2lmaWNhdGlvbiB8fCB0eXBlb2YgY2xhc3NpZmljYXRpb24gIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShjbGFzc2lmaWNhdGlvbikpIHRocm93IG5ldyBFcnJvcihcIlN5bmNDb29yZGluYXRvciBjbGFzc2lmeUVycm9yIG11c3QgcmV0dXJuIGFuIG9iamVjdFwiKVxuICBpZiAodHlwZW9mIGNsYXNzaWZpY2F0aW9uLmNvZGUgIT09IFwic3RyaW5nXCIgfHwgY2xhc3NpZmljYXRpb24uY29kZS5sZW5ndGggPT09IDApIHRocm93IG5ldyBFcnJvcihcIlN5bmNDb29yZGluYXRvciBlcnJvciBjbGFzc2lmaWNhdGlvbiBjb2RlIG11c3QgYmUgYSBub24tZW1wdHkgc3RyaW5nXCIpXG4gIGlmICh0eXBlb2YgY2xhc3NpZmljYXRpb24ucmV0cnlhYmxlICE9PSBcImJvb2xlYW5cIikgdGhyb3cgbmV3IEVycm9yKFwiU3luY0Nvb3JkaW5hdG9yIGVycm9yIGNsYXNzaWZpY2F0aW9uIHJldHJ5YWJsZSBtdXN0IGJlIGJvb2xlYW5cIilcbiAgaWYgKGNsYXNzaWZpY2F0aW9uLm1lc3NhZ2UgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgY2xhc3NpZmljYXRpb24ubWVzc2FnZSAhPT0gXCJzdHJpbmdcIikgdGhyb3cgbmV3IEVycm9yKFwiU3luY0Nvb3JkaW5hdG9yIGVycm9yIGNsYXNzaWZpY2F0aW9uIG1lc3NhZ2UgbXVzdCBiZSBhIHN0cmluZ1wiKVxuXG4gIHJldHVybiBjbGFzc2lmaWNhdGlvblxufVxuXG4vKipcbiAqIEJ1aWxkcyBvbmUgZmFpbHVyZSBzbmFwc2hvdCBhbmQgaXRzIG9wdGlvbmFsIGF1dG9tYXRpYy1yZXRyeSBkZWxheS5cbiAqIEBwYXJhbSB7e2F0dGVtcHQ6IG51bWJlciwgY2xhc3NpZmllZDoge2NvZGU6IHN0cmluZywgbWVzc2FnZT86IHN0cmluZywgcmV0cnlhYmxlOiBib29sZWFufSwgZmFpbGVkQXQ6IHN0cmluZywgcmV0cnlQb2xpY3k6IHtpbml0aWFsRGVsYXlNczogbnVtYmVyLCBtYXhBdHRlbXB0czogbnVtYmVyLCBtYXhEZWxheU1zOiBudW1iZXJ9LCBzdGF0dXM6IGltcG9ydChcIi4vc3luYy1jb29yZGluYXRvci10eXBlcy5qc1wiKS5TeW5jQ29vcmRpbmF0b3JTdGF0dXN9fSBhcmdzIC0gRmFpbHVyZSBzdGF0ZS5cbiAqIEByZXR1cm5zIHt7ZGVsYXlNczogbnVtYmVyIHwgbnVsbCwgc3RhdHVzOiBpbXBvcnQoXCIuL3N5bmMtY29vcmRpbmF0b3ItdHlwZXMuanNcIikuU3luY0Nvb3JkaW5hdG9yU3RhdHVzfX0gLSBGYWlsdXJlIHNuYXBzaG90IGFuZCByZXRyeSBkZWxheS5cbiAqL1xuZnVuY3Rpb24gZmFpbHVyZVN0YXR1c0Zvcih7YXR0ZW1wdCwgY2xhc3NpZmllZCwgZmFpbGVkQXQsIHJldHJ5UG9saWN5LCBzdGF0dXN9KSB7XG4gIGNvbnN0IHJldHJ5YWJsZSA9IGNsYXNzaWZpZWQucmV0cnlhYmxlICYmIGF0dGVtcHQgPCByZXRyeVBvbGljeS5tYXhBdHRlbXB0c1xuICBjb25zdCBkZWxheU1zID0gcmV0cnlhYmxlID8gTWF0aC5taW4ocmV0cnlQb2xpY3kuaW5pdGlhbERlbGF5TXMgKiAoMiAqKiAoYXR0ZW1wdCAtIDEpKSwgcmV0cnlQb2xpY3kubWF4RGVsYXlNcykgOiBudWxsXG4gIGNvbnN0IGZhaWx1cmUgPSB7XG4gICAgYXR0ZW1wdCxcbiAgICBhdDogZmFpbGVkQXQsXG4gICAgY29kZTogY2xhc3NpZmllZC5jb2RlLFxuICAgIC4uLihjbGFzc2lmaWVkLm1lc3NhZ2UgPT09IHVuZGVmaW5lZCA/IHt9IDoge21lc3NhZ2U6IGNsYXNzaWZpZWQubWVzc2FnZX0pLFxuICAgIHJldHJ5YWJsZTogY2xhc3NpZmllZC5yZXRyeWFibGVcbiAgfVxuICBjb25zdCBuZXh0UmV0cnlBdCA9IGRlbGF5TXMgPT09IG51bGwgPyBudWxsIDogbmV3IERhdGUobmV3IERhdGUoZmFpbGVkQXQpLmdldFRpbWUoKSArIGRlbGF5TXMpLnRvSVNPU3RyaW5nKClcblxuICByZXR1cm4ge1xuICAgIGRlbGF5TXMsXG4gICAgc3RhdHVzOiBpbW11dGFibGVTdGF0dXMoey4uLnN0YXR1cywgZmFpbHVyZSwgbmV4dFJldHJ5QXQsIHN0YXRlOiByZXRyeWFibGUgPyBcImJhY2tvZmZcIiA6IFwiZmFpbGVkXCJ9KVxuICB9XG59XG5cbi8qKlxuICogTWFwcyBkdXJhYmxlIHF1ZXVlIHN0YXRlIHRvIGFuIG9ic2VydmFibGUgcmVzdGluZyBzdGF0ZS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jLWNvb3JkaW5hdG9yLXR5cGVzLmpzXCIpLlN5bmNDbGllbnRJbnNwZWN0aW9ufSBpbnNwZWN0aW9uIC0gRHVyYWJsZSBpbnNwZWN0aW9uLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vc3luYy1jb29yZGluYXRvci10eXBlcy5qc1wiKS5TeW5jQ29vcmRpbmF0b3JTdGF0ZX0gLSBSZXN0aW5nIHN0YXRlLlxuICovXG5mdW5jdGlvbiBpbnNwZWN0aW9uU3RhdGUoaW5zcGVjdGlvbikge1xuICBpZiAoaW5zcGVjdGlvbi5jb25mbGljdHMubGVuZ3RoID4gMCkgcmV0dXJuIFwiY29uZmxpY3RlZFwiXG4gIGlmIChpbnNwZWN0aW9uLnJlamVjdGVkQ291bnQgPiAwKSByZXR1cm4gXCJmYWlsZWRcIlxuICBpZiAoaW5zcGVjdGlvbi5wZW5kaW5nQ291bnQgPiAwKSByZXR1cm4gXCJwZW5kaW5nXCJcblxuICByZXR1cm4gXCJpZGxlXCJcbn1cblxuLyoqXG4gKiBSZW1vdmVzIHN0YWxlIGluLWZsaWdodCB0aW1pbmcgZnJvbSBhIHJlc3RvcmVkIHN0YXR1cyBzbmFwc2hvdC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jLWNvb3JkaW5hdG9yLXR5cGVzLmpzXCIpLlN5bmNDb29yZGluYXRvclN0YXR1c30gc3RhdHVzIC0gU3RvcmVkIHN0YXR1cy5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3N5bmMtY29vcmRpbmF0b3ItdHlwZXMuanNcIikuU3luY0Nvb3JkaW5hdG9yU3RhdHVzfSAtIFJlc3RvcmVkIG9ic2VydmFibGUgc3RhdHVzLlxuICovXG5mdW5jdGlvbiByZXN0b3JlZFN0YXR1cyhzdGF0dXMpIHtcbiAgaWYgKCFDT09SRElOQVRPUl9TVEFURVMuaGFzKHN0YXR1cy5zdGF0ZSkpIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBwZXJzaXN0ZWQgU3luY0Nvb3JkaW5hdG9yIHN0YXRlOiAke1N0cmluZyhzdGF0dXMuc3RhdGUpfWApXG5cbiAgcmV0dXJuIHtcbiAgICBjb25mbGljdHM6IHN0YXR1cy5jb25mbGljdHMsXG4gICAgZmFpbHVyZTogc3RhdHVzLmZhaWx1cmUsXG4gICAgbGFzdFN1Y2Nlc3NBdDogc3RhdHVzLmxhc3RTdWNjZXNzQXQsXG4gICAgbmV4dFJldHJ5QXQ6IG51bGwsXG4gICAgcGVuZGluZ0NvdW50OiBzdGF0dXMucGVuZGluZ0NvdW50LFxuICAgIHJlamVjdGVkQ291bnQ6IHN0YXR1cy5yZWplY3RlZENvdW50LFxuICAgIHN0YXRlOiBzdGF0dXMuc3RhdGUgPT09IFwic3luY2luZ1wiIHx8IHN0YXR1cy5zdGF0ZSA9PT0gXCJiYWNrb2ZmXCIgPyBpbnNwZWN0aW9uU3RhdGUoc3RhdHVzKSA6IHN0YXR1cy5zdGF0ZVxuICB9XG59XG5cbi8qKlxuICogRGVlcC1mcmVlemVzIHRoZSBzdGF0dXMtb3duZWQgZGlhZ25vc3RpYyBjb2xsZWN0aW9ucy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jLWNvb3JkaW5hdG9yLXR5cGVzLmpzXCIpLlN5bmNDb29yZGluYXRvclN0YXR1c30gc3RhdHVzIC0gU25hcHNob3QuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9zeW5jLWNvb3JkaW5hdG9yLXR5cGVzLmpzXCIpLlN5bmNDb29yZGluYXRvclN0YXR1c30gLSBJbW11dGFibGUgc25hcHNob3QuXG4gKi9cbmZ1bmN0aW9uIGltbXV0YWJsZVN0YXR1cyhzdGF0dXMpIHtcbiAgY29uc3QgY29uZmxpY3RzID0gc3RhdHVzLmNvbmZsaWN0cy5tYXAoKGNvbmZsaWN0KSA9PiBPYmplY3QuZnJlZXplKHsuLi5jb25mbGljdH0pKVxuICBjb25zdCBmYWlsdXJlID0gc3RhdHVzLmZhaWx1cmUgPyBPYmplY3QuZnJlZXplKHsuLi5zdGF0dXMuZmFpbHVyZX0pIDogbnVsbFxuXG4gIHJldHVybiBPYmplY3QuZnJlZXplKHsuLi5zdGF0dXMsIGNvbmZsaWN0czogT2JqZWN0LmZyZWV6ZShjb25mbGljdHMpLCBmYWlsdXJlfSlcbn1cblxuLyoqXG4gKiBWYWxpZGF0ZXMgb25lIHJlcXVpcmVkIGNhbGxiYWNrLlxuICogQHBhcmFtIHt1bmtub3dufSB2YWx1ZSAtIEZ1bmN0aW9uIGNhbmRpZGF0ZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBsYWJlbCAtIENvbnRyYWN0IGxhYmVsLlxuICogQHJldHVybnMge3ZvaWR9IC0gVmFsaWRhdGVzIHRoZSBmdW5jdGlvbiBjYW5kaWRhdGUuXG4gKi9cbmZ1bmN0aW9uIHJlcXVpcmVGdW5jdGlvbih2YWx1ZSwgbGFiZWwpIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3IoYFN5bmNDb29yZGluYXRvciAke2xhYmVsfSBtdXN0IGJlIGEgZnVuY3Rpb25gKVxufVxuXG4vKipcbiAqIFZhbGlkYXRlcyB0aGUgU3luY0NsaWVudCBzdXJmYWNlIHJlcXVpcmVkIGJ5IHRoZSBjb29yZGluYXRvci5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jLWNsaWVudC5qc1wiKS5kZWZhdWx0fSBjbGllbnQgLSBDbGllbnQuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gcmVxdWlyZUNvb3JkaW5hdG9yQ2xpZW50KGNsaWVudCkge1xuICBpZiAoIWNsaWVudCkgdGhyb3cgbmV3IEVycm9yKFwiU3luY0Nvb3JkaW5hdG9yIHJlcXVpcmVzIGEgU3luY0NsaWVudFwiKVxuXG4gIHJlcXVpcmVGdW5jdGlvbihjbGllbnQuYXR0YWNoQ29vcmRpbmF0b3IsIFwic3luY0NsaWVudC5hdHRhY2hDb29yZGluYXRvclwiKVxuICByZXF1aXJlRnVuY3Rpb24oY2xpZW50Lmluc3BlY3RTeW5jU3RhdGUsIFwic3luY0NsaWVudC5pbnNwZWN0U3luY1N0YXRlXCIpXG4gIHJlcXVpcmVGdW5jdGlvbihjbGllbnQuaXNMaWZlY3ljbGVBYm9ydCwgXCJzeW5jQ2xpZW50LmlzTGlmZWN5Y2xlQWJvcnRcIilcbiAgcmVxdWlyZUZ1bmN0aW9uKGNsaWVudC5pc09ubGluZSwgXCJzeW5jQ2xpZW50LmlzT25saW5lXCIpXG4gIHJlcXVpcmVGdW5jdGlvbihjbGllbnQucHVsbCwgXCJzeW5jQ2xpZW50LnB1bGxcIilcbiAgcmVxdWlyZUZ1bmN0aW9uKGNsaWVudC5yZXBvcnRFcnJvciwgXCJzeW5jQ2xpZW50LnJlcG9ydEVycm9yXCIpXG4gIHJlcXVpcmVGdW5jdGlvbihjbGllbnQucmVwbGF5UGVuZGluZywgXCJzeW5jQ2xpZW50LnJlcGxheVBlbmRpbmdcIilcbiAgcmVxdWlyZUZ1bmN0aW9uKGNsaWVudC5yZXNvbHZlQ29uZmxpY3QsIFwic3luY0NsaWVudC5yZXNvbHZlQ29uZmxpY3RcIilcbiAgcmVxdWlyZUZ1bmN0aW9uKGNsaWVudC5zdGFydCwgXCJzeW5jQ2xpZW50LnN0YXJ0XCIpXG4gIHJlcXVpcmVGdW5jdGlvbihjbGllbnQuc3RvcCwgXCJzeW5jQ2xpZW50LnN0b3BcIilcbiAgcmVxdWlyZUZ1bmN0aW9uKGNsaWVudC5zdWJzY3JpYmVSZWFsdGltZSwgXCJzeW5jQ2xpZW50LnN1YnNjcmliZVJlYWx0aW1lXCIpXG4gIHJlcXVpcmVGdW5jdGlvbihjbGllbnQud2FpdEZvclNjaGVkdWxlZFJlcGxheSwgXCJzeW5jQ2xpZW50LndhaXRGb3JTY2hlZHVsZWRSZXBsYXlcIilcbn1cbiJdfQ==