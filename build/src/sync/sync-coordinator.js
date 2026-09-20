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
        await this.trigger("conflict-resolution");
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
            if (!await this.syncClient.isOnline()) {
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
                classified = normalizeErrorClassification(this.classifyError(/** @type {Error} */ (persistenceError)));
                failureStatus = failureStatusFor({ attempt: this._attempt, classified, failedAt, retryPolicy: this.retryPolicy, status: this._status });
                this._publish(failureStatus.status);
            }
        }
        if (failureStatus.delayMs === null)
            return;
        this._assertActive(generation);
        this._retryTimer = this.scheduler.setTimeout(() => {
            this._retryTimer = null;
            if (!this._ownsGeneration(generation))
                return;
            void this.trigger("automatic-retry");
        }, failureStatus.delayMs);
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
    requireFunction(client.replayPending, "syncClient.replayPending");
    requireFunction(client.resolveConflict, "syncClient.resolveConflict");
    requireFunction(client.start, "syncClient.start");
    requireFunction(client.stop, "syncClient.stop");
    requireFunction(client.subscribeRealtime, "syncClient.subscribeRealtime");
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1jb29yZGluYXRvci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9zeW5jL3N5bmMtY29vcmRpbmF0b3IuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sYUFBYSxNQUFNLDZCQUE2QixDQUFBO0FBRXZELE1BQU0sa0JBQWtCLEdBQUcsSUFBSSxHQUFHLENBQUMsQ0FBQyxTQUFTLEVBQUUsWUFBWSxFQUFFLFFBQVEsRUFBRSxNQUFNLEVBQUUsU0FBUyxFQUFFLFNBQVMsRUFBRSxTQUFTLEVBQUUsU0FBUyxDQUFDLENBQUMsQ0FBQTtBQUMzSCxNQUFNLGFBQWEsR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLEVBQUMsY0FBYyxFQUFFLEtBQUssRUFBRSxXQUFXLEVBQUUsQ0FBQyxFQUFFLFVBQVUsRUFBRSxNQUFNLEVBQUMsQ0FBQyxDQUFBO0FBRWhHLDBGQUEwRjtBQUMxRixNQUFNLE9BQU8sa0NBQW1DLFNBQVEsS0FBSztJQUMzRDs7O09BR0c7SUFDSCxZQUFZLE9BQU87UUFDakIsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBQ2QsSUFBSSxDQUFDLElBQUksR0FBRyxvQ0FBb0MsQ0FBQTtJQUNsRCxDQUFDO0NBQ0Y7QUFFRDs7Ozs7R0FLRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sZUFBZTtJQUNsQzs7Ozs7Ozs7Ozs7O09BWUc7SUFDSCxZQUFZLEVBQUMsYUFBYSxHQUFHLDBCQUEwQixFQUFFLFlBQVksRUFBRSxHQUFHLEdBQUcsR0FBRyxFQUFFLENBQUMsSUFBSSxJQUFJLEVBQUUsRUFBRSxPQUFPLEdBQUcsR0FBRyxFQUFFLENBQUMsU0FBUyxFQUFFLFFBQVEsR0FBRyxJQUFJLEVBQUUsS0FBSyxHQUFHLEVBQUUsRUFBRSxTQUFTLEdBQUcsZ0JBQWdCLEVBQUUsRUFBRSxXQUFXLEVBQUUsVUFBVSxFQUFFLEdBQUcsUUFBUSxFQUFDO1FBQzFOLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUN2Qix3QkFBd0IsQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUNwQyxlQUFlLENBQUMsYUFBYSxFQUFFLGVBQWUsQ0FBQyxDQUFBO1FBQy9DLGVBQWUsQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLENBQUE7UUFDM0IsZUFBZSxDQUFDLE9BQU8sRUFBRSxTQUFTLENBQUMsQ0FBQTtRQUNuQyxJQUFJLE9BQU8sUUFBUSxLQUFLLFNBQVM7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDBDQUEwQyxDQUFDLENBQUE7UUFDOUYsSUFBSSxZQUFZO1lBQUUsZUFBZSxDQUFDLFlBQVksQ0FBQyxTQUFTLEVBQUUsd0JBQXdCLENBQUMsQ0FBQTtRQUNuRixJQUFJLFdBQVcsRUFBRSxDQUFDO1lBQ2hCLGVBQWUsQ0FBQyxXQUFXLENBQUMsSUFBSSxFQUFFLGtCQUFrQixDQUFDLENBQUE7WUFDckQsZUFBZSxDQUFDLFdBQVcsQ0FBQyxJQUFJLEVBQUUsa0JBQWtCLENBQUMsQ0FBQTtRQUN2RCxDQUFDO1FBQ0QsZUFBZSxDQUFDLFNBQVMsQ0FBQyxZQUFZLEVBQUUsd0JBQXdCLENBQUMsQ0FBQTtRQUNqRSxlQUFlLENBQUMsU0FBUyxDQUFDLFVBQVUsRUFBRSxzQkFBc0IsQ0FBQyxDQUFBO1FBRTdELElBQUksQ0FBQyxVQUFVLEdBQUcsVUFBVSxDQUFBO1FBQzVCLElBQUksQ0FBQyxhQUFhLEdBQUcsYUFBYSxDQUFBO1FBQ2xDLElBQUksQ0FBQyxZQUFZLEdBQUcsWUFBWSxJQUFJLElBQUksQ0FBQTtRQUN4QyxJQUFJLENBQUMsR0FBRyxHQUFHLEdBQUcsQ0FBQTtRQUNkLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFBO1FBQ3RCLElBQUksQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFBO1FBQ3hCLElBQUksQ0FBQyxXQUFXLEdBQUcsb0JBQW9CLENBQUMsS0FBSyxDQUFDLENBQUE7UUFDOUMsSUFBSSxDQUFDLFNBQVMsR0FBRyxTQUFTLENBQUE7UUFDMUIsSUFBSSxDQUFDLFdBQVcsR0FBRyxXQUFXLElBQUksSUFBSSxDQUFBO1FBRXRDLElBQUksQ0FBQyxPQUFPLEdBQUcsS0FBSyxDQUFBO1FBQ3BCLElBQUksQ0FBQyxRQUFRLEdBQUcsQ0FBQyxDQUFBO1FBQ2pCLElBQUksQ0FBQyxXQUFXLEdBQUcsQ0FBQyxDQUFBO1FBQ3BCLElBQUksQ0FBQyx5QkFBeUIsR0FBRyxJQUFJLGVBQWUsRUFBRSxDQUFBO1FBQ3RELGlHQUFpRztRQUNqRyxJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFDM0IsZ0RBQWdEO1FBQ2hELElBQUksQ0FBQyxrQkFBa0IsR0FBRyxFQUFFLENBQUE7UUFDNUIsbUNBQW1DO1FBQ25DLElBQUksQ0FBQyxXQUFXLEdBQUcsSUFBSSxDQUFBO1FBQ3ZCLElBQUksQ0FBQyxlQUFlLEdBQUcsS0FBSyxDQUFBO1FBQzVCLHNCQUFzQjtRQUN0QixJQUFJLENBQUMsV0FBVyxHQUFHLElBQUksQ0FBQTtRQUN2QixtQ0FBbUM7UUFDbkMsSUFBSSxDQUFDLGFBQWEsR0FBRyxJQUFJLENBQUE7UUFDekIsbUNBQW1DO1FBQ25DLElBQUksQ0FBQyxZQUFZLEdBQUcsSUFBSSxDQUFBO1FBQ3hCLDBFQUEwRTtRQUMxRSxJQUFJLENBQUMsT0FBTyxHQUFHLGVBQWUsQ0FBQztZQUM3QixTQUFTLEVBQUUsRUFBRTtZQUNiLE9BQU8sRUFBRSxJQUFJO1lBQ2IsYUFBYSxFQUFFLElBQUk7WUFDbkIsV0FBVyxFQUFFLElBQUk7WUFDakIsWUFBWSxFQUFFLENBQUM7WUFDZixhQUFhLEVBQUUsQ0FBQztZQUNoQixLQUFLLEVBQUUsU0FBUztTQUNqQixDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUs7UUFDSCxJQUFJLElBQUksQ0FBQyxPQUFPLElBQUksQ0FBQyxJQUFJLENBQUMsYUFBYTtZQUFFLE9BQU8sT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFBO1FBQ2pFLElBQUksSUFBSSxDQUFDLGFBQWE7WUFBRSxPQUFPLElBQUksQ0FBQyxhQUFhLENBQUE7UUFDakQsSUFBSSxJQUFJLENBQUMsWUFBWTtZQUFFLE9BQU8sSUFBSSxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsS0FBSyxJQUFJLEVBQUUsQ0FBQyxNQUFNLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQyxDQUFBO1FBRXBGLElBQUksQ0FBQyxPQUFPLEdBQUcsSUFBSSxDQUFBO1FBQ25CLElBQUksQ0FBQyxRQUFRLEdBQUcsQ0FBQyxDQUFBO1FBQ2pCLE1BQU0sVUFBVSxHQUFHLEVBQUUsSUFBSSxDQUFDLFdBQVcsQ0FBQTtRQUVyQyxJQUFJLENBQUMseUJBQXlCLEdBQUcsSUFBSSxlQUFlLEVBQUUsQ0FBQTtRQUN0RCxJQUFJLENBQUMsYUFBYSxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUMsT0FBTyxDQUFDLEdBQUcsRUFBRTtZQUN4RCxJQUFJLENBQUMsYUFBYSxHQUFHLElBQUksQ0FBQTtRQUMzQixDQUFDLENBQUMsQ0FBQTtRQUVGLE9BQU8sSUFBSSxDQUFDLGFBQWEsQ0FBQTtJQUMzQixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxNQUFNLENBQUMsVUFBVTtRQUNyQixJQUFJLENBQUM7WUFDSCxNQUFNLElBQUksQ0FBQyxTQUFTLENBQUMsVUFBVSxDQUFDLENBQUE7UUFDbEMsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixJQUFJLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsVUFBVSxDQUFDO2dCQUFFLE1BQU0sS0FBSyxDQUFBO1lBRWxGLE1BQU0sSUFBSSxDQUFDLG9CQUFvQixDQUFDLG9CQUFvQixDQUFDLENBQUMsS0FBSyxDQUFDLEVBQUUsVUFBVSxDQUFDLENBQUE7UUFDM0UsQ0FBQztJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLFNBQVMsQ0FBQyxVQUFVO1FBQ3hCLElBQUksSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO1lBQ3JCLE1BQU0sZUFBZSxHQUFHLE1BQU0sSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLEVBQUUsQ0FBQTtZQUVyRCxJQUFJLENBQUMsYUFBYSxDQUFDLFVBQVUsQ0FBQyxDQUFBO1lBQzlCLElBQUksZUFBZTtnQkFBRSxJQUFJLENBQUMsUUFBUSxDQUFDLGNBQWMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFBO1FBQ3JFLENBQUM7UUFFRCxNQUFNLGlCQUFpQixHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsaUJBQWlCLENBQUMsS0FBSyxFQUFFLE1BQU0sRUFBRSxFQUFFLENBQUMsTUFBTSxJQUFJLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUE7UUFFekcsSUFBSSxDQUFDLGtCQUFrQixDQUFDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxDQUFBO1FBRS9DLElBQUksSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFDO1lBQ3RCLE1BQU0sdUJBQXVCLEdBQUcsSUFBSSxDQUFDLFlBQVksQ0FBQyxTQUFTLENBQUMsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxFQUFDLFVBQVUsRUFBRSxNQUFNLEVBQUMsQ0FBQyxDQUFDLENBQUE7WUFFeEgsSUFBSSxDQUFDLGtCQUFrQixDQUFDLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxDQUFBO1FBQ3ZELENBQUM7UUFFRCxJQUFJLENBQUMsYUFBYSxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBQzlCLE1BQU0sSUFBSSxDQUFDLFVBQVUsQ0FBQyxLQUFLLEVBQUUsQ0FBQTtRQUM3QixJQUFJLENBQUMsYUFBYSxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBRTlCLE1BQU0sT0FBTyxHQUFHLE1BQU0sSUFBSSxDQUFDLE9BQU8sQ0FBQyxFQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMseUJBQXlCLENBQUMsTUFBTSxFQUFFLFVBQVUsRUFBRSxJQUFJLENBQUMsVUFBVSxFQUFDLENBQUMsQ0FBQTtRQUVoSCxJQUFJLE9BQU8sS0FBSyxTQUFTO1lBQUUsZUFBZSxDQUFDLE9BQU8sRUFBRSxrQkFBa0IsQ0FBQyxDQUFBO1FBQ3ZFLElBQUksQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUM7WUFDdEMsSUFBSSxPQUFPO2dCQUFFLE1BQU0sT0FBTyxFQUFFLENBQUE7WUFDNUIsTUFBTSxJQUFJLGtDQUFrQyxDQUFDLDZDQUE2QyxDQUFDLENBQUE7UUFDN0YsQ0FBQztRQUNELElBQUksT0FBTztZQUFFLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUE7UUFFbEQsSUFBSSxDQUFDLGVBQWUsR0FBRyxJQUFJLENBQUE7UUFDM0IsS0FBSyxJQUFJLENBQUMsa0JBQWtCLEVBQUUsQ0FBQTtJQUNoQyxDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILEtBQUssQ0FBQyxvQkFBb0IsQ0FBQyxLQUFLLEVBQUUsVUFBVTtRQUMxQyxJQUFJLENBQUMsT0FBTyxHQUFHLEtBQUssQ0FBQTtRQUNwQixJQUFJLENBQUMsV0FBVyxJQUFJLENBQUMsQ0FBQTtRQUNyQixJQUFJLENBQUMseUJBQXlCLENBQUMsS0FBSyxDQUFDLElBQUksa0NBQWtDLENBQUMsK0JBQStCLENBQUMsQ0FBQyxDQUFBO1FBQzdHLElBQUksQ0FBQyxlQUFlLEdBQUcsS0FBSyxDQUFBO1FBQzVCLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1FBRXZCLHdCQUF3QjtRQUN4QixNQUFNLGNBQWMsR0FBRyxFQUFFLENBQUE7UUFDekIsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLGtCQUFrQixDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLEVBQUUsQ0FBQTtRQUU1RCxJQUFJLENBQUM7WUFDSCxNQUFNLElBQUksQ0FBQyxVQUFVLENBQUMsSUFBSSxFQUFFLENBQUE7UUFDOUIsQ0FBQztRQUFDLE9BQU8sU0FBUyxFQUFFLENBQUM7WUFDbkIsY0FBYyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQTtRQUNoQyxDQUFDO1FBRUQsS0FBSyxNQUFNLE9BQU8sSUFBSSxRQUFRLEVBQUUsQ0FBQztZQUMvQixJQUFJLENBQUM7Z0JBQ0gsTUFBTSxPQUFPLEVBQUUsQ0FBQTtZQUNqQixDQUFDO1lBQUMsT0FBTyxZQUFZLEVBQUUsQ0FBQztnQkFDdEIsY0FBYyxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQTtZQUNuQyxDQUFDO1FBQ0gsQ0FBQztRQUVELE1BQU0sVUFBVSxHQUFHLDRCQUE0QixDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQTtRQUMxRSxNQUFNLE9BQU8sR0FBRztZQUNkLE9BQU8sRUFBRSxDQUFDO1lBQ1YsRUFBRSxFQUFFLElBQUksQ0FBQyxPQUFPLEVBQUU7WUFDbEIsSUFBSSxFQUFFLFVBQVUsQ0FBQyxJQUFJO1lBQ3JCLEdBQUcsQ0FBQyxVQUFVLENBQUMsT0FBTyxLQUFLLFNBQVMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFDLE9BQU8sRUFBRSxVQUFVLENBQUMsT0FBTyxFQUFDLENBQUM7WUFDMUUsU0FBUyxFQUFFLFVBQVUsQ0FBQyxTQUFTO1NBQ2hDLENBQUE7UUFFRCxJQUFJLENBQUMsUUFBUSxHQUFHLENBQUMsQ0FBQTtRQUNqQixJQUFJLENBQUMsUUFBUSxDQUFDLEVBQUMsR0FBRyxJQUFJLENBQUMsT0FBTyxFQUFFLE9BQU8sRUFBRSxXQUFXLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUMsQ0FBQyxDQUFBO1FBRTdFLElBQUksSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO1lBQ3JCLElBQUksQ0FBQztnQkFDSCxNQUFNLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQTtZQUMzQyxDQUFDO1lBQUMsT0FBTyxnQkFBZ0IsRUFBRSxDQUFDO2dCQUMxQixjQUFjLENBQUMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLENBQUE7WUFDdkMsQ0FBQztRQUNILENBQUM7UUFFRCxJQUFJLGNBQWMsQ0FBQyxNQUFNLEdBQUcsQ0FBQztZQUFFLE1BQU0sSUFBSSxjQUFjLENBQUMsQ0FBQyxLQUFLLEVBQUUsR0FBRyxjQUFjLENBQUMsRUFBRSwrQkFBK0IsVUFBVSx3Q0FBd0MsQ0FBQyxDQUFBO1FBRXRLLE1BQU0sS0FBSyxDQUFBO0lBQ2IsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxJQUFJO1FBQ0YsSUFBSSxJQUFJLENBQUMsWUFBWTtZQUFFLE9BQU8sSUFBSSxDQUFDLFlBQVksQ0FBQTtRQUMvQyxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sSUFBSSxDQUFDLElBQUksQ0FBQyxhQUFhLElBQUksQ0FBQyxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7WUFDOUQsSUFBSSxJQUFJLENBQUMsT0FBTyxDQUFDLEtBQUssS0FBSyxTQUFTO2dCQUFFLElBQUksQ0FBQyxRQUFRLENBQUMsRUFBQyxHQUFHLElBQUksQ0FBQyxPQUFPLEVBQUUsV0FBVyxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFDLENBQUMsQ0FBQTtZQUUzRyxPQUFPLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQTtRQUMxQixDQUFDO1FBRUQsSUFBSSxDQUFDLE9BQU8sR0FBRyxLQUFLLENBQUE7UUFDcEIsSUFBSSxDQUFDLFdBQVcsSUFBSSxDQUFDLENBQUE7UUFDckIsSUFBSSxDQUFDLHlCQUF5QixDQUFDLEtBQUssQ0FBQyxJQUFJLGtDQUFrQyxDQUFDLDhCQUE4QixDQUFDLENBQUMsQ0FBQTtRQUM1RyxJQUFJLENBQUMsZUFBZSxHQUFHLEtBQUssQ0FBQTtRQUM1QixJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQTtRQUV2QixNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsa0JBQWtCLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sRUFBRSxDQUFBO1FBQzVELE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUE7UUFDdkMsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLFdBQVcsQ0FBQTtRQUVuQyxJQUFJLENBQUMsWUFBWSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsRUFBQyxRQUFRLEVBQUUsVUFBVSxFQUFFLFlBQVksRUFBQyxDQUFDLENBQUMsT0FBTyxDQUFDLEdBQUcsRUFBRTtZQUNoRixJQUFJLENBQUMsWUFBWSxHQUFHLElBQUksQ0FBQTtRQUMxQixDQUFDLENBQUMsQ0FBQTtRQUVGLE9BQU8sSUFBSSxDQUFDLFlBQVksQ0FBQTtJQUMxQixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxLQUFLLENBQUMsRUFBQyxRQUFRLEVBQUUsVUFBVSxFQUFFLFlBQVksRUFBQztRQUM5Qyx3QkFBd0I7UUFDeEIsTUFBTSxNQUFNLEdBQUcsRUFBRSxDQUFBO1FBRWpCLElBQUksQ0FBQztZQUNILE1BQU0sSUFBSSxDQUFDLFVBQVUsQ0FBQyxJQUFJLEVBQUUsQ0FBQTtRQUM5QixDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUE7UUFDcEIsQ0FBQztRQUVELEtBQUssTUFBTSxPQUFPLElBQUksQ0FBQyxZQUFZLEVBQUUsVUFBVSxDQUFDLEVBQUUsQ0FBQztZQUNqRCxJQUFJLENBQUMsT0FBTztnQkFBRSxTQUFRO1lBRXRCLElBQUksQ0FBQztnQkFDSCxNQUFNLE9BQU8sQ0FBQTtZQUNmLENBQUM7WUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO2dCQUNmLElBQUksQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsS0FBSyxDQUFDO29CQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUE7WUFDdkQsQ0FBQztRQUNILENBQUM7UUFFRCxLQUFLLE1BQU0sT0FBTyxJQUFJLFFBQVEsRUFBRSxDQUFDO1lBQy9CLElBQUksQ0FBQztnQkFDSCxNQUFNLE9BQU8sRUFBRSxDQUFBO1lBQ2pCLENBQUM7WUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO2dCQUNmLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUE7WUFDcEIsQ0FBQztRQUNILENBQUM7UUFFRCxJQUFJLENBQUMsUUFBUSxHQUFHLENBQUMsQ0FBQTtRQUNqQixJQUFJLENBQUMsUUFBUSxDQUFDLEVBQUMsR0FBRyxJQUFJLENBQUMsT0FBTyxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsV0FBVyxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFDLENBQUMsQ0FBQTtRQUVwRixJQUFJLE1BQU0sQ0FBQyxNQUFNLEtBQUssQ0FBQztZQUFFLE1BQU0sTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFBO1FBQ3hDLElBQUksTUFBTSxDQUFDLE1BQU0sR0FBRyxDQUFDO1lBQUUsTUFBTSxJQUFJLGNBQWMsQ0FBQyxNQUFNLEVBQUUsa0NBQWtDLENBQUMsQ0FBQTtJQUM3RixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxPQUFPLENBQUMsTUFBTSxHQUFHLFFBQVE7UUFDdkIsS0FBSyxNQUFNLENBQUE7UUFDWCxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU87WUFBRSxPQUFPLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQTtRQUUzQyxJQUFJLENBQUMsZUFBZSxHQUFHLElBQUksQ0FBQTtRQUMzQixJQUFJLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztZQUN2QixPQUFPLElBQUksQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUM1QixLQUFLLElBQUksRUFBRSxDQUFDLE1BQU0sSUFBSSxDQUFDLGtCQUFrQixFQUFFLEVBQzNDLEdBQUcsRUFBRSxDQUFDLFNBQVMsQ0FDaEIsQ0FBQTtRQUNILENBQUM7UUFFRCxPQUFPLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxDQUFBO0lBQ2xDLENBQUM7SUFFRDs7O09BR0c7SUFDSCxrQkFBa0I7UUFDaEIsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPO1lBQUUsT0FBTyxPQUFPLENBQUMsT0FBTyxFQUFFLENBQUE7UUFDM0MsSUFBSSxJQUFJLENBQUMsV0FBVyxLQUFLLElBQUk7WUFBRSxPQUFPLElBQUksQ0FBQyxXQUFXLElBQUksT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFBO1FBQzNFLElBQUksQ0FBQyxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7WUFDdEIsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLFdBQVcsQ0FBQTtZQUVuQyxJQUFJLENBQUMsV0FBVyxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUMsT0FBTyxDQUFDLEdBQUcsRUFBRTtnQkFDdEQsSUFBSSxDQUFDLFdBQVcsR0FBRyxJQUFJLENBQUE7WUFDekIsQ0FBQyxDQUFDLENBQUE7UUFDSixDQUFDO1FBRUQsT0FBTyxJQUFJLENBQUMsV0FBVyxDQUFBO0lBQ3pCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLO1FBQ0gsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx3Q0FBd0MsQ0FBQyxDQUFBO1FBRTVFLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1FBQ3ZCLElBQUksQ0FBQyxRQUFRLEdBQUcsQ0FBQyxDQUFBO1FBRWpCLE9BQU8sSUFBSSxDQUFDLE9BQU8sQ0FBQyxjQUFjLENBQUMsQ0FBQTtJQUNyQyxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsZUFBZSxDQUFDLElBQUk7UUFDeEIsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx3REFBd0QsQ0FBQyxDQUFBO1FBRTVGLE1BQU0sSUFBSSxDQUFDLFVBQVUsQ0FBQyxlQUFlLENBQUMsSUFBSSxDQUFDLENBQUE7UUFDM0MsSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUE7UUFDdkIsSUFBSSxDQUFDLFFBQVEsR0FBRyxDQUFDLENBQUE7UUFDakIsTUFBTSxJQUFJLENBQUMsT0FBTyxDQUFDLHFCQUFxQixDQUFDLENBQUE7SUFDM0MsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsTUFBTSxDQUFDLFVBQVU7UUFDckIsT0FBTyxJQUFJLENBQUMsZUFBZSxJQUFJLElBQUksQ0FBQyxlQUFlLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztZQUNoRSxJQUFJLENBQUMsZUFBZSxHQUFHLEtBQUssQ0FBQTtZQUM1QixNQUFNLFNBQVMsR0FBRyxNQUFNLElBQUksQ0FBQyxTQUFTLENBQUMsVUFBVSxDQUFDLENBQUE7WUFFbEQsSUFBSSxDQUFDLFNBQVM7Z0JBQUUsSUFBSSxDQUFDLGVBQWUsR0FBRyxLQUFLLENBQUE7UUFDOUMsQ0FBQztJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLFNBQVMsQ0FBQyxVQUFVO1FBQ3hCLElBQUksQ0FBQztZQUNILElBQUksQ0FBQyxNQUFNLElBQUksQ0FBQyxVQUFVLENBQUMsUUFBUSxFQUFFLEVBQUUsQ0FBQztnQkFDdEMsTUFBTSxVQUFVLEdBQUcsTUFBTSxJQUFJLENBQUMsVUFBVSxDQUFDLGdCQUFnQixFQUFFLENBQUE7Z0JBRTNELElBQUksQ0FBQyxhQUFhLENBQUMsVUFBVSxDQUFDLENBQUE7Z0JBQzlCLElBQUksQ0FBQyxRQUFRLENBQUMsRUFBQyxHQUFHLElBQUksQ0FBQyxPQUFPLEVBQUUsR0FBRyxVQUFVLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxXQUFXLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUMsQ0FBQyxDQUFBO2dCQUNuRyxNQUFNLElBQUksQ0FBQyxjQUFjLENBQUMsVUFBVSxDQUFDLENBQUE7Z0JBRXJDLE9BQU8sS0FBSyxDQUFBO1lBQ2QsQ0FBQztZQUVELElBQUksQ0FBQyxRQUFRLENBQUMsRUFBQyxHQUFHLElBQUksQ0FBQyxPQUFPLEVBQUUsV0FBVyxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFDLENBQUMsQ0FBQTtZQUNyRSxNQUFNLElBQUksQ0FBQyxVQUFVLENBQUMsYUFBYSxFQUFFLENBQUE7WUFDckMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxVQUFVLENBQUMsQ0FBQTtZQUM5QixJQUFJLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztnQkFDbEIsTUFBTSxJQUFJLENBQUMsVUFBVSxDQUFDLGlCQUFpQixFQUFFLENBQUE7Z0JBQ3pDLElBQUksQ0FBQyxhQUFhLENBQUMsVUFBVSxDQUFDLENBQUE7WUFDaEMsQ0FBQztZQUNELE1BQU0sSUFBSSxDQUFDLFVBQVUsQ0FBQyxJQUFJLEVBQUUsQ0FBQTtZQUM1QixJQUFJLENBQUMsYUFBYSxDQUFDLFVBQVUsQ0FBQyxDQUFBO1lBRTlCLE1BQU0sVUFBVSxHQUFHLE1BQU0sSUFBSSxDQUFDLFVBQVUsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1lBRTNELElBQUksQ0FBQyxhQUFhLENBQUMsVUFBVSxDQUFDLENBQUE7WUFDOUIsSUFBSSxDQUFDLFFBQVEsQ0FBQztnQkFDWixHQUFHLElBQUksQ0FBQyxPQUFPO2dCQUNmLEdBQUcsVUFBVTtnQkFDYixPQUFPLEVBQUUsSUFBSTtnQkFDYixhQUFhLEVBQUUsSUFBSSxDQUFDLE9BQU8sRUFBRTtnQkFDN0IsV0FBVyxFQUFFLElBQUk7Z0JBQ2pCLEtBQUssRUFBRSxlQUFlLENBQUMsVUFBVSxDQUFDO2FBQ25DLENBQUMsQ0FBQTtZQUNGLE1BQU0sSUFBSSxDQUFDLGNBQWMsQ0FBQyxVQUFVLENBQUMsQ0FBQTtZQUNyQyxJQUFJLENBQUMsUUFBUSxHQUFHLENBQUMsQ0FBQTtZQUVqQixPQUFPLElBQUksQ0FBQTtRQUNiLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsSUFBSSxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsVUFBVSxDQUFDLElBQUksSUFBSSxDQUFDLGdCQUFnQixDQUFDLEtBQUssQ0FBQyxJQUFJLElBQUksQ0FBQyxVQUFVLENBQUMsZ0JBQWdCLENBQUMsS0FBSyxDQUFDO2dCQUFFLE9BQU8sS0FBSyxDQUFBO1lBRTlILE1BQU0sSUFBSSxDQUFDLGNBQWMsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLEtBQUssQ0FBQyxFQUFFLFVBQVUsQ0FBQyxDQUFBO1lBRW5FLE9BQU8sS0FBSyxDQUFBO1FBQ2QsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxjQUFjLENBQUMsS0FBSyxFQUFFLFVBQVU7UUFDcEMsSUFBSSxDQUFDLFFBQVEsSUFBSSxDQUFDLENBQUE7UUFDbEIsSUFBSSxVQUFVLEdBQUcsNEJBQTRCLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFBO1FBQ3hFLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQTtRQUMvQixJQUFJLGFBQWEsR0FBRyxnQkFBZ0IsQ0FBQyxFQUFDLE9BQU8sRUFBRSxJQUFJLENBQUMsUUFBUSxFQUFFLFVBQVUsRUFBRSxRQUFRLEVBQUUsV0FBVyxFQUFFLElBQUksQ0FBQyxXQUFXLEVBQUUsTUFBTSxFQUFFLElBQUksQ0FBQyxPQUFPLEVBQUMsQ0FBQyxDQUFBO1FBRXpJLElBQUksQ0FBQyxRQUFRLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBRW5DLElBQUksSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO1lBQ3JCLElBQUksQ0FBQztnQkFDSCxNQUFNLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQTtnQkFDekMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxVQUFVLENBQUMsQ0FBQTtZQUNoQyxDQUFDO1lBQUMsT0FBTyxnQkFBZ0IsRUFBRSxDQUFDO2dCQUMxQixVQUFVLEdBQUcsNEJBQTRCLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLENBQUMsQ0FBQyxDQUFBO2dCQUN0RyxhQUFhLEdBQUcsZ0JBQWdCLENBQUMsRUFBQyxPQUFPLEVBQUUsSUFBSSxDQUFDLFFBQVEsRUFBRSxVQUFVLEVBQUUsUUFBUSxFQUFFLFdBQVcsRUFBRSxJQUFJLENBQUMsV0FBVyxFQUFFLE1BQU0sRUFBRSxJQUFJLENBQUMsT0FBTyxFQUFDLENBQUMsQ0FBQTtnQkFDckksSUFBSSxDQUFDLFFBQVEsQ0FBQyxhQUFhLENBQUMsTUFBTSxDQUFDLENBQUE7WUFDckMsQ0FBQztRQUNILENBQUM7UUFFRCxJQUFJLGFBQWEsQ0FBQyxPQUFPLEtBQUssSUFBSTtZQUFFLE9BQU07UUFFMUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUM5QixJQUFJLENBQUMsV0FBVyxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsVUFBVSxDQUFDLEdBQUcsRUFBRTtZQUNoRCxJQUFJLENBQUMsV0FBVyxHQUFHLElBQUksQ0FBQTtZQUN2QixJQUFJLENBQUMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxVQUFVLENBQUM7Z0JBQUUsT0FBTTtZQUU3QyxLQUFLLElBQUksQ0FBQyxPQUFPLENBQUMsaUJBQWlCLENBQUMsQ0FBQTtRQUN0QyxDQUFDLEVBQUUsYUFBYSxDQUFDLE9BQU8sQ0FBQyxDQUFBO0lBQzNCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLGNBQWMsQ0FBQyxVQUFVO1FBQzdCLElBQUksSUFBSSxDQUFDLFdBQVc7WUFBRSxNQUFNLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQTtRQUMvRCxJQUFJLENBQUMsYUFBYSxDQUFDLFVBQVUsQ0FBQyxDQUFBO0lBQ2hDLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsb0JBQW9CLENBQUMsRUFBQyxVQUFVLEVBQUUsTUFBTSxFQUFDO1FBQ3ZDLElBQUksQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLFVBQVUsQ0FBQztZQUFFLE9BQU07UUFFN0MsSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUE7UUFDdkIsSUFBSSxNQUFNO1lBQUUsSUFBSSxDQUFDLFFBQVEsR0FBRyxDQUFDLENBQUE7UUFDN0IsS0FBSyxJQUFJLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMscUJBQXFCLENBQUMsQ0FBQyxDQUFDLHNCQUFzQixDQUFDLENBQUE7SUFDNUUsQ0FBQztJQUVEOzs7T0FHRztJQUNILGdCQUFnQjtRQUNkLElBQUksSUFBSSxDQUFDLFdBQVcsS0FBSyxJQUFJO1lBQUUsT0FBTTtRQUVyQyxJQUFJLENBQUMsU0FBUyxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUE7UUFDN0MsSUFBSSxDQUFDLFdBQVcsR0FBRyxJQUFJLENBQUE7SUFDekIsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxlQUFlLENBQUMsVUFBVTtRQUN4QixPQUFPLElBQUksQ0FBQyxPQUFPLElBQUksSUFBSSxDQUFDLFdBQVcsS0FBSyxVQUFVLENBQUE7SUFDeEQsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxhQUFhLENBQUMsVUFBVTtRQUN0QixJQUFJLElBQUksQ0FBQyxlQUFlLENBQUMsVUFBVSxDQUFDO1lBQUUsT0FBTTtRQUU1QyxNQUFNLElBQUksa0NBQWtDLENBQUMseURBQXlELENBQUMsQ0FBQTtJQUN6RyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGdCQUFnQixDQUFDLEtBQUs7UUFDcEIsT0FBTyxLQUFLLFlBQVksa0NBQWtDLENBQUE7SUFDNUQsQ0FBQztJQUVEOzs7T0FHRztJQUNILE9BQU87UUFDTCxNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUE7UUFFeEIsSUFBSSxDQUFDLENBQUMsS0FBSyxZQUFZLElBQUksQ0FBQyxJQUFJLE1BQU0sQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxnREFBZ0QsQ0FBQyxDQUFBO1FBRWhJLE9BQU8sS0FBSyxDQUFDLFdBQVcsRUFBRSxDQUFBO0lBQzVCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsUUFBUSxDQUFDLE1BQU07UUFDYixJQUFJLENBQUMsT0FBTyxHQUFHLGVBQWUsQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUV0QyxLQUFLLE1BQU0sUUFBUSxJQUFJLElBQUksQ0FBQyxVQUFVO1lBQUUsUUFBUSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQTtJQUNoRSxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsTUFBTTtRQUNKLE9BQU8sSUFBSSxDQUFDLE9BQU8sQ0FBQTtJQUNyQixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILFNBQVMsQ0FBQyxRQUFRO1FBQ2hCLGVBQWUsQ0FBQyxRQUFRLEVBQUUsaUJBQWlCLENBQUMsQ0FBQTtRQUM1QyxJQUFJLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUM3QixRQUFRLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBRXRCLE9BQU8sR0FBRyxFQUFFLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUE7SUFDL0MsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxpQkFBaUI7UUFDckIsT0FBTyxJQUFJLENBQUMsV0FBVztZQUFFLE1BQU0sSUFBSSxDQUFDLFdBQVcsQ0FBQTtJQUNqRCxDQUFDO0NBQ0Y7QUFFRDs7O0dBR0c7QUFDSCxTQUFTLGdCQUFnQjtJQUN2QixPQUFPO1FBQ0wsWUFBWSxFQUFFLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxVQUFVLENBQUMsWUFBWSxDQUFDLDRDQUE0QyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUM7UUFDdEcsVUFBVSxFQUFFLENBQUMsUUFBUSxFQUFFLE9BQU8sRUFBRSxFQUFFLENBQUMsVUFBVSxDQUFDLFVBQVUsQ0FBQyxRQUFRLEVBQUUsT0FBTyxDQUFDO0tBQzVFLENBQUE7QUFDSCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsb0JBQW9CLENBQUMsS0FBSztJQUNqQyxNQUFNLE1BQU0sR0FBRyxFQUFDLEdBQUcsYUFBYSxFQUFFLEdBQUcsS0FBSyxFQUFDLENBQUE7SUFFM0MsS0FBSyxNQUFNLENBQUMsSUFBSSxFQUFFLEtBQUssQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQztRQUNuRCxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsSUFBSSxLQUFLLEdBQUcsQ0FBQztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMseUJBQXlCLElBQUksNkJBQTZCLENBQUMsQ0FBQTtJQUN4SCxDQUFDO0lBQ0QsSUFBSSxNQUFNLENBQUMsVUFBVSxHQUFHLE1BQU0sQ0FBQyxjQUFjO1FBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxrRkFBa0YsQ0FBQyxDQUFBO0lBRWxKLE9BQU8sTUFBTSxDQUFBO0FBQ2YsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLDBCQUEwQixDQUFDLE1BQU07SUFDeEMsT0FBTyxFQUFDLElBQUksRUFBRSxhQUFhLEVBQUUsU0FBUyxFQUFFLEtBQUssRUFBQyxDQUFBO0FBQ2hELENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUyw0QkFBNEIsQ0FBQyxjQUFjO0lBQ2xELElBQUksQ0FBQyxjQUFjLElBQUksT0FBTyxjQUFjLEtBQUssUUFBUSxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsY0FBYyxDQUFDO1FBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxxREFBcUQsQ0FBQyxDQUFBO0lBQ2xLLElBQUksT0FBTyxjQUFjLENBQUMsSUFBSSxLQUFLLFFBQVEsSUFBSSxjQUFjLENBQUMsSUFBSSxDQUFDLE1BQU0sS0FBSyxDQUFDO1FBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxzRUFBc0UsQ0FBQyxDQUFBO0lBQ3hLLElBQUksT0FBTyxjQUFjLENBQUMsU0FBUyxLQUFLLFNBQVM7UUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLGdFQUFnRSxDQUFDLENBQUE7SUFDcEksSUFBSSxjQUFjLENBQUMsT0FBTyxLQUFLLFNBQVMsSUFBSSxPQUFPLGNBQWMsQ0FBQyxPQUFPLEtBQUssUUFBUTtRQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsK0RBQStELENBQUMsQ0FBQTtJQUV4SyxPQUFPLGNBQWMsQ0FBQTtBQUN2QixDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsZ0JBQWdCLENBQUMsRUFBQyxPQUFPLEVBQUUsVUFBVSxFQUFFLFFBQVEsRUFBRSxXQUFXLEVBQUUsTUFBTSxFQUFDO0lBQzVFLE1BQU0sU0FBUyxHQUFHLFVBQVUsQ0FBQyxTQUFTLElBQUksT0FBTyxHQUFHLFdBQVcsQ0FBQyxXQUFXLENBQUE7SUFDM0UsTUFBTSxPQUFPLEdBQUcsU0FBUyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLFdBQVcsQ0FBQyxjQUFjLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxPQUFPLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxXQUFXLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQTtJQUN0SCxNQUFNLE9BQU8sR0FBRztRQUNkLE9BQU87UUFDUCxFQUFFLEVBQUUsUUFBUTtRQUNaLElBQUksRUFBRSxVQUFVLENBQUMsSUFBSTtRQUNyQixHQUFHLENBQUMsVUFBVSxDQUFDLE9BQU8sS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBQyxPQUFPLEVBQUUsVUFBVSxDQUFDLE9BQU8sRUFBQyxDQUFDO1FBQzFFLFNBQVMsRUFBRSxVQUFVLENBQUMsU0FBUztLQUNoQyxDQUFBO0lBQ0QsTUFBTSxXQUFXLEdBQUcsT0FBTyxLQUFLLElBQUksQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLElBQUksQ0FBQyxJQUFJLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQyxPQUFPLEVBQUUsR0FBRyxPQUFPLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQTtJQUU1RyxPQUFPO1FBQ0wsT0FBTztRQUNQLE1BQU0sRUFBRSxlQUFlLENBQUMsRUFBQyxHQUFHLE1BQU0sRUFBRSxPQUFPLEVBQUUsV0FBVyxFQUFFLEtBQUssRUFBRSxTQUFTLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsUUFBUSxFQUFDLENBQUM7S0FDcEcsQ0FBQTtBQUNILENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUyxlQUFlLENBQUMsVUFBVTtJQUNqQyxJQUFJLFVBQVUsQ0FBQyxTQUFTLENBQUMsTUFBTSxHQUFHLENBQUM7UUFBRSxPQUFPLFlBQVksQ0FBQTtJQUN4RCxJQUFJLFVBQVUsQ0FBQyxhQUFhLEdBQUcsQ0FBQztRQUFFLE9BQU8sUUFBUSxDQUFBO0lBQ2pELElBQUksVUFBVSxDQUFDLFlBQVksR0FBRyxDQUFDO1FBQUUsT0FBTyxTQUFTLENBQUE7SUFFakQsT0FBTyxNQUFNLENBQUE7QUFDZixDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsY0FBYyxDQUFDLE1BQU07SUFDNUIsSUFBSSxDQUFDLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDO1FBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyw0Q0FBNEMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLENBQUE7SUFFOUgsT0FBTztRQUNMLFNBQVMsRUFBRSxNQUFNLENBQUMsU0FBUztRQUMzQixPQUFPLEVBQUUsTUFBTSxDQUFDLE9BQU87UUFDdkIsYUFBYSxFQUFFLE1BQU0sQ0FBQyxhQUFhO1FBQ25DLFdBQVcsRUFBRSxJQUFJO1FBQ2pCLFlBQVksRUFBRSxNQUFNLENBQUMsWUFBWTtRQUNqQyxhQUFhLEVBQUUsTUFBTSxDQUFDLGFBQWE7UUFDbkMsS0FBSyxFQUFFLE1BQU0sQ0FBQyxLQUFLLEtBQUssU0FBUyxJQUFJLE1BQU0sQ0FBQyxLQUFLLEtBQUssU0FBUyxDQUFDLENBQUMsQ0FBQyxlQUFlLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLO0tBQ3pHLENBQUE7QUFDSCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsZUFBZSxDQUFDLE1BQU07SUFDN0IsTUFBTSxTQUFTLEdBQUcsTUFBTSxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxRQUFRLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFBQyxHQUFHLFFBQVEsRUFBQyxDQUFDLENBQUMsQ0FBQTtJQUNsRixNQUFNLE9BQU8sR0FBRyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLEVBQUMsR0FBRyxNQUFNLENBQUMsT0FBTyxFQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFBO0lBRTFFLE9BQU8sTUFBTSxDQUFDLE1BQU0sQ0FBQyxFQUFDLEdBQUcsTUFBTSxFQUFFLFNBQVMsRUFBRSxNQUFNLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxFQUFFLE9BQU8sRUFBQyxDQUFDLENBQUE7QUFDakYsQ0FBQztBQUVEOzs7OztHQUtHO0FBQ0gsU0FBUyxlQUFlLENBQUMsS0FBSyxFQUFFLEtBQUs7SUFDbkMsSUFBSSxPQUFPLEtBQUssS0FBSyxVQUFVO1FBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxtQkFBbUIsS0FBSyxxQkFBcUIsQ0FBQyxDQUFBO0FBQ2pHLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUyx3QkFBd0IsQ0FBQyxNQUFNO0lBQ3RDLElBQUksQ0FBQyxNQUFNO1FBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx1Q0FBdUMsQ0FBQyxDQUFBO0lBRXJFLGVBQWUsQ0FBQyxNQUFNLENBQUMsaUJBQWlCLEVBQUUsOEJBQThCLENBQUMsQ0FBQTtJQUN6RSxlQUFlLENBQUMsTUFBTSxDQUFDLGdCQUFnQixFQUFFLDZCQUE2QixDQUFDLENBQUE7SUFDdkUsZUFBZSxDQUFDLE1BQU0sQ0FBQyxnQkFBZ0IsRUFBRSw2QkFBNkIsQ0FBQyxDQUFBO0lBQ3ZFLGVBQWUsQ0FBQyxNQUFNLENBQUMsUUFBUSxFQUFFLHFCQUFxQixDQUFDLENBQUE7SUFDdkQsZUFBZSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsaUJBQWlCLENBQUMsQ0FBQTtJQUMvQyxlQUFlLENBQUMsTUFBTSxDQUFDLGFBQWEsRUFBRSwwQkFBMEIsQ0FBQyxDQUFBO0lBQ2pFLGVBQWUsQ0FBQyxNQUFNLENBQUMsZUFBZSxFQUFFLDRCQUE0QixDQUFDLENBQUE7SUFDckUsZUFBZSxDQUFDLE1BQU0sQ0FBQyxLQUFLLEVBQUUsa0JBQWtCLENBQUMsQ0FBQTtJQUNqRCxlQUFlLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxpQkFBaUIsQ0FBQyxDQUFBO0lBQy9DLGVBQWUsQ0FBQyxNQUFNLENBQUMsaUJBQWlCLEVBQUUsOEJBQThCLENBQUMsQ0FBQTtBQUMzRSxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCByZXN0QXJnc0Vycm9yIGZyb20gXCIuLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuXG5jb25zdCBDT09SRElOQVRPUl9TVEFURVMgPSBuZXcgU2V0KFtcImJhY2tvZmZcIiwgXCJjb25mbGljdGVkXCIsIFwiZmFpbGVkXCIsIFwiaWRsZVwiLCBcIm9mZmxpbmVcIiwgXCJwZW5kaW5nXCIsIFwic3RvcHBlZFwiLCBcInN5bmNpbmdcIl0pXG5jb25zdCBERUZBVUxUX1JFVFJZID0gT2JqZWN0LmZyZWV6ZSh7aW5pdGlhbERlbGF5TXM6IDFfMDAwLCBtYXhBdHRlbXB0czogNCwgbWF4RGVsYXlNczogMzBfMDAwfSlcblxuLyoqIEV4cGVjdGVkIGNvb3BlcmF0aXZlIGNhbmNlbGxhdGlvbiByYWlzZWQgYnkgYSBTeW5jQ29vcmRpbmF0b3IgbGlmZWN5Y2xlIHRyYW5zaXRpb24uICovXG5leHBvcnQgY2xhc3MgU3luY0Nvb3JkaW5hdG9yTGlmZWN5Y2xlQWJvcnRFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBsaWZlY3ljbGUgY2FuY2VsbGF0aW9uIGVycm9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWVzc2FnZSAtIENhbmNlbGxhdGlvbiByZWFzb24uXG4gICAqL1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlKSB7XG4gICAgc3VwZXIobWVzc2FnZSlcbiAgICB0aGlzLm5hbWUgPSBcIlN5bmNDb29yZGluYXRvckxpZmVjeWNsZUFib3J0RXJyb3JcIlxuICB9XG59XG5cbi8qKlxuICogUmV1c2FibGUgb2JzZXJ2YWJsZSBsaWZlY3ljbGUgYXJvdW5kIFN5bmNDbGllbnQuIEl0IHNlcmlhbGl6ZXMgcmVwbGF5LFxuICogcmVhbHRpbWUgc3Vic2NyaXB0aW9uLCBhbmQgc3RhYmxlLWN1cnNvciBwdWxsIGludG8gb25lIGN5Y2xlOyBjb2FsZXNjZXMgYW55XG4gKiB0cmlnZ2VycyByZWNlaXZlZCBkdXJpbmcgdGhhdCBjeWNsZSBpbnRvIG9uZSByZXJ1bjsgb3ducyBib3VuZGVkIHJldHJ5OyBhbmRcbiAqIGdlbmVyYXRpb24tZmVuY2VzIHN0YXR1cyB1cGRhdGVzIGFmdGVyIHN0b3AvcmVzdGFydC5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgU3luY0Nvb3JkaW5hdG9yIHtcbiAgLyoqXG4gICAqIENyZWF0ZXMgb25lIHJldXNhYmxlIHN5bmMgbGlmZWN5Y2xlIG93bmVyLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIENvb3JkaW5hdG9yIGRlcGVuZGVuY2llcy5cbiAgICogQHBhcmFtIHsoZXJyb3I6IEVycm9yKSA9PiB7Y29kZTogc3RyaW5nLCBtZXNzYWdlPzogc3RyaW5nLCByZXRyeWFibGU6IGJvb2xlYW59fSBbYXJncy5jbGFzc2lmeUVycm9yXSAtIE1hcHMgZXJyb3JzIHRvIHNhZmUgcmV0cnkvZGlzcGxheSBtZXRhZGF0YS4gRGVmYXVsdHMgdG8gcGVybWFuZW50IGBzeW5jX2ZhaWxlZGAgd2l0aG91dCBwZXJzaXN0aW5nIHRoZSBlcnJvciBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy1jb29yZGluYXRvci10eXBlcy5qc1wiKS5TeW5jQ29vcmRpbmF0b3JDb25uZWN0aXZpdHl9IFthcmdzLmNvbm5lY3Rpdml0eV0gLSBPcHRpb25hbCBjb25uZWN0aXZpdHkgZXZlbnQgc291cmNlLlxuICAgKiBAcGFyYW0geygpID0+IERhdGV9IFthcmdzLm5vd10gLSBJbmplY3RlZCBjbG9jay5cbiAgICogQHBhcmFtIHsoYXJnczoge3NpZ25hbDogQWJvcnRTaWduYWwsIHN5bmNDbGllbnQ6IGltcG9ydChcIi4vc3luYy1jbGllbnQuanNcIikuZGVmYXVsdH0pID0+IFByb21pc2U8KCgpID0+IFByb21pc2U8dm9pZD4gfCB2b2lkKSB8IHZvaWQ+IHwgKCgpID0+IFByb21pc2U8dm9pZD4gfCB2b2lkKSB8IHZvaWR9IFthcmdzLnByZXBhcmVdIC0gQWN0aXZhdGVzIHNjb3Blcy9hY3F1aXJlcyBhcHAtb3duZWQgcmVzb3VyY2VzIGJlZm9yZSB0aGUgZmlyc3QgY3ljbGUgYW5kIHJldHVybnMgdGhlaXIgdGVhcmRvd24uXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MucmVhbHRpbWVdIC0gV2hldGhlciBjeWNsZXMgc3Vic2NyaWJlIHJlYWx0aW1lIGJlZm9yZSBwdWxsaW5nLiBEZWZhdWx0cyB0byB0cnVlLlxuICAgKiBAcGFyYW0ge3tpbml0aWFsRGVsYXlNcz86IG51bWJlciwgbWF4QXR0ZW1wdHM/OiBudW1iZXIsIG1heERlbGF5TXM/OiBudW1iZXJ9fSBbYXJncy5yZXRyeV0gLSBCb3VuZGVkIGF1dG9tYXRpYyByZXRyeSBwb2xpY3kuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jLWNvb3JkaW5hdG9yLXR5cGVzLmpzXCIpLlN5bmNDb29yZGluYXRvclNjaGVkdWxlcn0gW2FyZ3Muc2NoZWR1bGVyXSAtIEluamVjdGVkIHRpbWVyIG93bmVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy1jb29yZGluYXRvci10eXBlcy5qc1wiKS5TeW5jQ29vcmRpbmF0b3JTdGF0dXNTdG9yZX0gW2FyZ3Muc3RhdHVzU3RvcmVdIC0gT3B0aW9uYWwgcHJpdmFjeS1zYWZlIGR1cmFibGUgc3RhdHVzIHN0b3JlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy1jbGllbnQuanNcIikuZGVmYXVsdH0gYXJncy5zeW5jQ2xpZW50IC0gU3luY0NsaWVudCBvd25pbmcgcXVldWUsIHNjb3BlcywgY3Vyc29ycywgYXBwbHksIGFuZCByZWFsdGltZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjbGFzc2lmeUVycm9yID0gZGVmYXVsdEVycm9yQ2xhc3NpZmljYXRpb24sIGNvbm5lY3Rpdml0eSwgbm93ID0gKCkgPT4gbmV3IERhdGUoKSwgcHJlcGFyZSA9ICgpID0+IHVuZGVmaW5lZCwgcmVhbHRpbWUgPSB0cnVlLCByZXRyeSA9IHt9LCBzY2hlZHVsZXIgPSBkZWZhdWx0U2NoZWR1bGVyKCksIHN0YXR1c1N0b3JlLCBzeW5jQ2xpZW50LCAuLi5yZXN0QXJnc30pIHtcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuICAgIHJlcXVpcmVDb29yZGluYXRvckNsaWVudChzeW5jQ2xpZW50KVxuICAgIHJlcXVpcmVGdW5jdGlvbihjbGFzc2lmeUVycm9yLCBcImNsYXNzaWZ5RXJyb3JcIilcbiAgICByZXF1aXJlRnVuY3Rpb24obm93LCBcIm5vd1wiKVxuICAgIHJlcXVpcmVGdW5jdGlvbihwcmVwYXJlLCBcInByZXBhcmVcIilcbiAgICBpZiAodHlwZW9mIHJlYWx0aW1lICE9PSBcImJvb2xlYW5cIikgdGhyb3cgbmV3IEVycm9yKFwiU3luY0Nvb3JkaW5hdG9yIHJlYWx0aW1lIG11c3QgYmUgYm9vbGVhblwiKVxuICAgIGlmIChjb25uZWN0aXZpdHkpIHJlcXVpcmVGdW5jdGlvbihjb25uZWN0aXZpdHkuc3Vic2NyaWJlLCBcImNvbm5lY3Rpdml0eS5zdWJzY3JpYmVcIilcbiAgICBpZiAoc3RhdHVzU3RvcmUpIHtcbiAgICAgIHJlcXVpcmVGdW5jdGlvbihzdGF0dXNTdG9yZS5sb2FkLCBcInN0YXR1c1N0b3JlLmxvYWRcIilcbiAgICAgIHJlcXVpcmVGdW5jdGlvbihzdGF0dXNTdG9yZS5zYXZlLCBcInN0YXR1c1N0b3JlLnNhdmVcIilcbiAgICB9XG4gICAgcmVxdWlyZUZ1bmN0aW9uKHNjaGVkdWxlci5jbGVhclRpbWVvdXQsIFwic2NoZWR1bGVyLmNsZWFyVGltZW91dFwiKVxuICAgIHJlcXVpcmVGdW5jdGlvbihzY2hlZHVsZXIuc2V0VGltZW91dCwgXCJzY2hlZHVsZXIuc2V0VGltZW91dFwiKVxuXG4gICAgdGhpcy5zeW5jQ2xpZW50ID0gc3luY0NsaWVudFxuICAgIHRoaXMuY2xhc3NpZnlFcnJvciA9IGNsYXNzaWZ5RXJyb3JcbiAgICB0aGlzLmNvbm5lY3Rpdml0eSA9IGNvbm5lY3Rpdml0eSB8fCBudWxsXG4gICAgdGhpcy5ub3cgPSBub3dcbiAgICB0aGlzLnByZXBhcmUgPSBwcmVwYXJlXG4gICAgdGhpcy5yZWFsdGltZSA9IHJlYWx0aW1lXG4gICAgdGhpcy5yZXRyeVBvbGljeSA9IG5vcm1hbGl6ZVJldHJ5UG9saWN5KHJldHJ5KVxuICAgIHRoaXMuc2NoZWR1bGVyID0gc2NoZWR1bGVyXG4gICAgdGhpcy5zdGF0dXNTdG9yZSA9IHN0YXR1c1N0b3JlIHx8IG51bGxcblxuICAgIHRoaXMuX2FjdGl2ZSA9IGZhbHNlXG4gICAgdGhpcy5fYXR0ZW1wdCA9IDBcbiAgICB0aGlzLl9nZW5lcmF0aW9uID0gMFxuICAgIHRoaXMuX2xpZmVjeWNsZUFib3J0Q29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKVxuICAgIC8qKiBAdHlwZSB7U2V0PChzdGF0dXM6IGltcG9ydChcIi4vc3luYy1jb29yZGluYXRvci10eXBlcy5qc1wiKS5TeW5jQ29vcmRpbmF0b3JTdGF0dXMpID0+IHZvaWQ+fSAqL1xuICAgIHRoaXMuX2xpc3RlbmVycyA9IG5ldyBTZXQoKVxuICAgIC8qKiBAdHlwZSB7QXJyYXk8KCkgPT4gUHJvbWlzZTx2b2lkPiB8IHZvaWQ+fSAqL1xuICAgIHRoaXMuX2xpZmVjeWNsZUNsZWFudXBzID0gW11cbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCBudWxsfSAqL1xuICAgIHRoaXMuX3J1blByb21pc2UgPSBudWxsXG4gICAgdGhpcy5fcmVydW5SZXF1ZXN0ZWQgPSBmYWxzZVxuICAgIC8qKiBAdHlwZSB7dW5rbm93bn0gKi9cbiAgICB0aGlzLl9yZXRyeVRpbWVyID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IG51bGx9ICovXG4gICAgdGhpcy5fc3RhcnRQcm9taXNlID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IG51bGx9ICovXG4gICAgdGhpcy5fc3RvcFByb21pc2UgPSBudWxsXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3N5bmMtY29vcmRpbmF0b3ItdHlwZXMuanNcIikuU3luY0Nvb3JkaW5hdG9yU3RhdHVzfSAqL1xuICAgIHRoaXMuX3N0YXR1cyA9IGltbXV0YWJsZVN0YXR1cyh7XG4gICAgICBjb25mbGljdHM6IFtdLFxuICAgICAgZmFpbHVyZTogbnVsbCxcbiAgICAgIGxhc3RTdWNjZXNzQXQ6IG51bGwsXG4gICAgICBuZXh0UmV0cnlBdDogbnVsbCxcbiAgICAgIHBlbmRpbmdDb3VudDogMCxcbiAgICAgIHJlamVjdGVkQ291bnQ6IDAsXG4gICAgICBzdGF0ZTogXCJzdG9wcGVkXCJcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEluc3RhbGxzIGxvY2FsIG93bmVyc2hpcCBhbmQgc2NoZWR1bGVzIHRoZSBpbml0aWFsIG5ldHdvcmsgY3ljbGUgd2l0aG91dFxuICAgKiBhd2FpdGluZyBpdCwgc28gY2FjaGVkIHJlYWRzIG5ldmVyIGRlcGVuZCBvbiBuZXR3b3JrIGNvbXBsZXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGxvY2FsIG93bmVyc2hpcCBpcyBpbnN0YWxsZWQuXG4gICAqL1xuICBzdGFydCgpIHtcbiAgICBpZiAodGhpcy5fYWN0aXZlICYmICF0aGlzLl9zdGFydFByb21pc2UpIHJldHVybiBQcm9taXNlLnJlc29sdmUoKVxuICAgIGlmICh0aGlzLl9zdGFydFByb21pc2UpIHJldHVybiB0aGlzLl9zdGFydFByb21pc2VcbiAgICBpZiAodGhpcy5fc3RvcFByb21pc2UpIHJldHVybiB0aGlzLl9zdG9wUHJvbWlzZS50aGVuKGFzeW5jICgpID0+IGF3YWl0IHRoaXMuc3RhcnQoKSlcblxuICAgIHRoaXMuX2FjdGl2ZSA9IHRydWVcbiAgICB0aGlzLl9hdHRlbXB0ID0gMFxuICAgIGNvbnN0IGdlbmVyYXRpb24gPSArK3RoaXMuX2dlbmVyYXRpb25cblxuICAgIHRoaXMuX2xpZmVjeWNsZUFib3J0Q29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKVxuICAgIHRoaXMuX3N0YXJ0UHJvbWlzZSA9IHRoaXMuX3N0YXJ0KGdlbmVyYXRpb24pLmZpbmFsbHkoKCkgPT4ge1xuICAgICAgdGhpcy5fc3RhcnRQcm9taXNlID0gbnVsbFxuICAgIH0pXG5cbiAgICByZXR1cm4gdGhpcy5fc3RhcnRQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogU3RhcnRzIG9uZSBsaWZlY3ljbGUgZ2VuZXJhdGlvbiB3aXRoIHJvbGxiYWNrIG9uIGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBnZW5lcmF0aW9uIC0gT3duaW5nIGdlbmVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGFjdGl2YXRpb24gY29tcGxldGVzLlxuICAgKi9cbiAgYXN5bmMgX3N0YXJ0KGdlbmVyYXRpb24pIHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fYWN0aXZhdGUoZ2VuZXJhdGlvbilcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKHRoaXMuaXNMaWZlY3ljbGVBYm9ydChlcnJvcikgfHwgIXRoaXMuX293bnNHZW5lcmF0aW9uKGdlbmVyYXRpb24pKSB0aHJvdyBlcnJvclxuXG4gICAgICBhd2FpdCB0aGlzLl9yb2xsYmFja0ZhaWxlZFN0YXJ0KC8qKiBAdHlwZSB7RXJyb3J9ICovIChlcnJvciksIGdlbmVyYXRpb24pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFjcXVpcmVzIGNvb3JkaW5hdG9yLCBjb25uZWN0aXZpdHksIGNsaWVudCwgYW5kIGFwcGxpY2F0aW9uIHJlc291cmNlcy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGdlbmVyYXRpb24gLSBPd25pbmcgZ2VuZXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZXZlcnkgb3duZXIgaXMgYWN0aXZlLlxuICAgKi9cbiAgYXN5bmMgX2FjdGl2YXRlKGdlbmVyYXRpb24pIHtcbiAgICBpZiAodGhpcy5zdGF0dXNTdG9yZSkge1xuICAgICAgY29uc3QgcGVyc2lzdGVkU3RhdHVzID0gYXdhaXQgdGhpcy5zdGF0dXNTdG9yZS5sb2FkKClcblxuICAgICAgdGhpcy5fYXNzZXJ0QWN0aXZlKGdlbmVyYXRpb24pXG4gICAgICBpZiAocGVyc2lzdGVkU3RhdHVzKSB0aGlzLl9wdWJsaXNoKHJlc3RvcmVkU3RhdHVzKHBlcnNpc3RlZFN0YXR1cykpXG4gICAgfVxuXG4gICAgY29uc3QgZGV0YWNoQ29vcmRpbmF0b3IgPSB0aGlzLnN5bmNDbGllbnQuYXR0YWNoQ29vcmRpbmF0b3IoYXN5bmMgKHJlYXNvbikgPT4gYXdhaXQgdGhpcy50cmlnZ2VyKHJlYXNvbikpXG5cbiAgICB0aGlzLl9saWZlY3ljbGVDbGVhbnVwcy5wdXNoKGRldGFjaENvb3JkaW5hdG9yKVxuXG4gICAgaWYgKHRoaXMuY29ubmVjdGl2aXR5KSB7XG4gICAgICBjb25zdCB1bnN1YnNjcmliZUNvbm5lY3Rpdml0eSA9IHRoaXMuY29ubmVjdGl2aXR5LnN1YnNjcmliZSgob25saW5lKSA9PiB0aGlzLl9jb25uZWN0aXZpdHlDaGFuZ2VkKHtnZW5lcmF0aW9uLCBvbmxpbmV9KSlcblxuICAgICAgdGhpcy5fbGlmZWN5Y2xlQ2xlYW51cHMucHVzaCh1bnN1YnNjcmliZUNvbm5lY3Rpdml0eSlcbiAgICB9XG5cbiAgICB0aGlzLl9hc3NlcnRBY3RpdmUoZ2VuZXJhdGlvbilcbiAgICBhd2FpdCB0aGlzLnN5bmNDbGllbnQuc3RhcnQoKVxuICAgIHRoaXMuX2Fzc2VydEFjdGl2ZShnZW5lcmF0aW9uKVxuXG4gICAgY29uc3QgcmVsZWFzZSA9IGF3YWl0IHRoaXMucHJlcGFyZSh7c2lnbmFsOiB0aGlzLl9saWZlY3ljbGVBYm9ydENvbnRyb2xsZXIuc2lnbmFsLCBzeW5jQ2xpZW50OiB0aGlzLnN5bmNDbGllbnR9KVxuXG4gICAgaWYgKHJlbGVhc2UgIT09IHVuZGVmaW5lZCkgcmVxdWlyZUZ1bmN0aW9uKHJlbGVhc2UsIFwicHJlcGFyZSB0ZWFyZG93blwiKVxuICAgIGlmICghdGhpcy5fb3duc0dlbmVyYXRpb24oZ2VuZXJhdGlvbikpIHtcbiAgICAgIGlmIChyZWxlYXNlKSBhd2FpdCByZWxlYXNlKClcbiAgICAgIHRocm93IG5ldyBTeW5jQ29vcmRpbmF0b3JMaWZlY3ljbGVBYm9ydEVycm9yKFwiU3luYyBjb29yZGluYXRvciBzdG9wcGVkIGR1cmluZyBwcmVwYXJhdGlvblwiKVxuICAgIH1cbiAgICBpZiAocmVsZWFzZSkgdGhpcy5fbGlmZWN5Y2xlQ2xlYW51cHMucHVzaChyZWxlYXNlKVxuXG4gICAgdGhpcy5fcmVydW5SZXF1ZXN0ZWQgPSB0cnVlXG4gICAgdm9pZCB0aGlzLl9zdGFydFJlcXVlc3RlZFJ1bigpXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgZXZlcnkgcGFydGlhbGx5IGFjcXVpcmVkIG93bmVyIGFmdGVyIGEgZmFpbGVkIHN0YXJ0LCBwdWJsaXNoZXMgYVxuICAgKiBzYWZlIHRlcm1pbmFsIGZhaWx1cmUsIGFuZCByZXRocm93cyB0aGUgb3JpZ2luYWwgZXJyb3IgKG9yIGFuIGFnZ3JlZ2F0ZSBpZlxuICAgKiB0ZWFyZG93biBhbHNvIGZhaWxlZCkuXG4gICAqIEBwYXJhbSB7RXJyb3J9IGVycm9yIC0gU3RhcnQgZmFpbHVyZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGdlbmVyYXRpb24gLSBGYWlsZWQgZ2VuZXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8bmV2ZXI+fSAtIEFsd2F5cyByZWplY3RzIHdpdGggdGhlIHN0YXJ0IG9yIGFnZ3JlZ2F0ZSBlcnJvci5cbiAgICovXG4gIGFzeW5jIF9yb2xsYmFja0ZhaWxlZFN0YXJ0KGVycm9yLCBnZW5lcmF0aW9uKSB7XG4gICAgdGhpcy5fYWN0aXZlID0gZmFsc2VcbiAgICB0aGlzLl9nZW5lcmF0aW9uICs9IDFcbiAgICB0aGlzLl9saWZlY3ljbGVBYm9ydENvbnRyb2xsZXIuYWJvcnQobmV3IFN5bmNDb29yZGluYXRvckxpZmVjeWNsZUFib3J0RXJyb3IoXCJTeW5jIGNvb3JkaW5hdG9yIHN0YXJ0IGZhaWxlZFwiKSlcbiAgICB0aGlzLl9yZXJ1blJlcXVlc3RlZCA9IGZhbHNlXG4gICAgdGhpcy5fY2xlYXJSZXRyeVRpbWVyKClcblxuICAgIC8qKiBAdHlwZSB7dW5rbm93bltdfSAqL1xuICAgIGNvbnN0IHRlYXJkb3duRXJyb3JzID0gW11cbiAgICBjb25zdCBjbGVhbnVwcyA9IHRoaXMuX2xpZmVjeWNsZUNsZWFudXBzLnNwbGljZSgwKS5yZXZlcnNlKClcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnN5bmNDbGllbnQuc3RvcCgpXG4gICAgfSBjYXRjaCAoc3RvcEVycm9yKSB7XG4gICAgICB0ZWFyZG93bkVycm9ycy5wdXNoKHN0b3BFcnJvcilcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGNsZWFudXAgb2YgY2xlYW51cHMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGNsZWFudXAoKVxuICAgICAgfSBjYXRjaCAoY2xlYW51cEVycm9yKSB7XG4gICAgICAgIHRlYXJkb3duRXJyb3JzLnB1c2goY2xlYW51cEVycm9yKVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGNsYXNzaWZpZWQgPSBub3JtYWxpemVFcnJvckNsYXNzaWZpY2F0aW9uKHRoaXMuY2xhc3NpZnlFcnJvcihlcnJvcikpXG4gICAgY29uc3QgZmFpbHVyZSA9IHtcbiAgICAgIGF0dGVtcHQ6IDEsXG4gICAgICBhdDogdGhpcy5fbm93SXNvKCksXG4gICAgICBjb2RlOiBjbGFzc2lmaWVkLmNvZGUsXG4gICAgICAuLi4oY2xhc3NpZmllZC5tZXNzYWdlID09PSB1bmRlZmluZWQgPyB7fSA6IHttZXNzYWdlOiBjbGFzc2lmaWVkLm1lc3NhZ2V9KSxcbiAgICAgIHJldHJ5YWJsZTogY2xhc3NpZmllZC5yZXRyeWFibGVcbiAgICB9XG5cbiAgICB0aGlzLl9hdHRlbXB0ID0gMVxuICAgIHRoaXMuX3B1Ymxpc2goey4uLnRoaXMuX3N0YXR1cywgZmFpbHVyZSwgbmV4dFJldHJ5QXQ6IG51bGwsIHN0YXRlOiBcImZhaWxlZFwifSlcblxuICAgIGlmICh0aGlzLnN0YXR1c1N0b3JlKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLnN0YXR1c1N0b3JlLnNhdmUodGhpcy5fc3RhdHVzKVxuICAgICAgfSBjYXRjaCAocGVyc2lzdGVuY2VFcnJvcikge1xuICAgICAgICB0ZWFyZG93bkVycm9ycy5wdXNoKHBlcnNpc3RlbmNlRXJyb3IpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHRlYXJkb3duRXJyb3JzLmxlbmd0aCA+IDApIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihbZXJyb3IsIC4uLnRlYXJkb3duRXJyb3JzXSwgYFN5bmMgY29vcmRpbmF0b3IgZ2VuZXJhdGlvbiAke2dlbmVyYXRpb259IGZhaWxlZCB0byBzdGFydCBhbmQgdGVhciBkb3duIGNsZWFubHlgKVxuXG4gICAgdGhyb3cgZXJyb3JcbiAgfVxuXG4gIC8qKlxuICAgKiBTdG9wcyBjdXJyZW50IHdvcmssIGNsZWFycyB0aW1lcnMvbGlzdGVuZXJzLCBkcmFpbnMgU3luY0NsaWVudCwgYW5kIHJlbGVhc2VzXG4gICAqIGFwcC1vd25lZCByZXNvdXJjZXMgZXhhY3RseSBvbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgbGlmZWN5Y2xlIGlzIGZ1bGx5IHN0b3BwZWQuXG4gICAqL1xuICBzdG9wKCkge1xuICAgIGlmICh0aGlzLl9zdG9wUHJvbWlzZSkgcmV0dXJuIHRoaXMuX3N0b3BQcm9taXNlXG4gICAgaWYgKCF0aGlzLl9hY3RpdmUgJiYgIXRoaXMuX3N0YXJ0UHJvbWlzZSAmJiAhdGhpcy5fcnVuUHJvbWlzZSkge1xuICAgICAgaWYgKHRoaXMuX3N0YXR1cy5zdGF0ZSAhPT0gXCJzdG9wcGVkXCIpIHRoaXMuX3B1Ymxpc2goey4uLnRoaXMuX3N0YXR1cywgbmV4dFJldHJ5QXQ6IG51bGwsIHN0YXRlOiBcInN0b3BwZWRcIn0pXG5cbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKVxuICAgIH1cblxuICAgIHRoaXMuX2FjdGl2ZSA9IGZhbHNlXG4gICAgdGhpcy5fZ2VuZXJhdGlvbiArPSAxXG4gICAgdGhpcy5fbGlmZWN5Y2xlQWJvcnRDb250cm9sbGVyLmFib3J0KG5ldyBTeW5jQ29vcmRpbmF0b3JMaWZlY3ljbGVBYm9ydEVycm9yKFwiU3luYyBjb29yZGluYXRvciB3YXMgc3RvcHBlZFwiKSlcbiAgICB0aGlzLl9yZXJ1blJlcXVlc3RlZCA9IGZhbHNlXG4gICAgdGhpcy5fY2xlYXJSZXRyeVRpbWVyKClcblxuICAgIGNvbnN0IGNsZWFudXBzID0gdGhpcy5fbGlmZWN5Y2xlQ2xlYW51cHMuc3BsaWNlKDApLnJldmVyc2UoKVxuICAgIGNvbnN0IHN0YXJ0UHJvbWlzZSA9IHRoaXMuX3N0YXJ0UHJvbWlzZVxuICAgIGNvbnN0IHJ1blByb21pc2UgPSB0aGlzLl9ydW5Qcm9taXNlXG5cbiAgICB0aGlzLl9zdG9wUHJvbWlzZSA9IHRoaXMuX3N0b3Aoe2NsZWFudXBzLCBydW5Qcm9taXNlLCBzdGFydFByb21pc2V9KS5maW5hbGx5KCgpID0+IHtcbiAgICAgIHRoaXMuX3N0b3BQcm9taXNlID0gbnVsbFxuICAgIH0pXG5cbiAgICByZXR1cm4gdGhpcy5fc3RvcFByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBEcmFpbnMgY2FwdHVyZWQgbGlmZWN5Y2xlIHJlc291cmNlcyBhZnRlciBhIHN0b3AgdHJhbnNpdGlvbi5cbiAgICogQHBhcmFtIHt7Y2xlYW51cHM6IEFycmF5PCgpID0+IFByb21pc2U8dm9pZD4gfCB2b2lkPiwgcnVuUHJvbWlzZTogUHJvbWlzZTx2b2lkPiB8IG51bGwsIHN0YXJ0UHJvbWlzZTogUHJvbWlzZTx2b2lkPiB8IG51bGx9fSBhcmdzIC0gQ2FwdHVyZWQgZ2VuZXJhdGlvbiByZXNvdXJjZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRlYXJkb3duIGNvbXBsZXRlcy5cbiAgICovXG4gIGFzeW5jIF9zdG9wKHtjbGVhbnVwcywgcnVuUHJvbWlzZSwgc3RhcnRQcm9taXNlfSkge1xuICAgIC8qKiBAdHlwZSB7dW5rbm93bltdfSAqL1xuICAgIGNvbnN0IGVycm9ycyA9IFtdXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5zeW5jQ2xpZW50LnN0b3AoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBlcnJvcnMucHVzaChlcnJvcilcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHByb21pc2Ugb2YgW3N0YXJ0UHJvbWlzZSwgcnVuUHJvbWlzZV0pIHtcbiAgICAgIGlmICghcHJvbWlzZSkgY29udGludWVcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgcHJvbWlzZVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKCF0aGlzLmlzTGlmZWN5Y2xlQWJvcnQoZXJyb3IpKSBlcnJvcnMucHVzaChlcnJvcilcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGNsZWFudXAgb2YgY2xlYW51cHMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGNsZWFudXAoKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgZXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5fYXR0ZW1wdCA9IDBcbiAgICB0aGlzLl9wdWJsaXNoKHsuLi50aGlzLl9zdGF0dXMsIGZhaWx1cmU6IG51bGwsIG5leHRSZXRyeUF0OiBudWxsLCBzdGF0ZTogXCJzdG9wcGVkXCJ9KVxuXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPT09IDEpIHRocm93IGVycm9yc1swXVxuICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMSkgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKGVycm9ycywgXCJTeW5jIGNvb3JkaW5hdG9yIHRlYXJkb3duIGZhaWxlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcXVlc3RzIGEgY3ljbGUuIE92ZXJsYXBwaW5nIHJlcXVlc3RzIHNoYXJlIHRoZSBhY3RpdmUgZmxpZ2h0IGFuZCBwcm9kdWNlXG4gICAqIGF0IG1vc3Qgb25lIHF1ZXVlZCByZXJ1bi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFtyZWFzb25dIC0gRGlhZ25vc3RpYyB0cmlnZ2VyIGxhYmVsIChuZXZlciBwZXJzaXN0ZWQpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgY3VycmVudCBvciBxdWV1ZWQgY3ljbGUgZHJhaW5zLlxuICAgKi9cbiAgdHJpZ2dlcihyZWFzb24gPSBcIm1hbnVhbFwiKSB7XG4gICAgdm9pZCByZWFzb25cbiAgICBpZiAoIXRoaXMuX2FjdGl2ZSkgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpXG5cbiAgICB0aGlzLl9yZXJ1blJlcXVlc3RlZCA9IHRydWVcbiAgICBpZiAodGhpcy5fc3RhcnRQcm9taXNlKSB7XG4gICAgICByZXR1cm4gdGhpcy5fc3RhcnRQcm9taXNlLnRoZW4oXG4gICAgICAgIGFzeW5jICgpID0+IGF3YWl0IHRoaXMuX3N0YXJ0UmVxdWVzdGVkUnVuKCksXG4gICAgICAgICgpID0+IHVuZGVmaW5lZFxuICAgICAgKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9zdGFydFJlcXVlc3RlZFJ1bigpXG4gIH1cblxuICAvKipcbiAgICogU3RhcnRzIHJlcXVlc3RlZCB3b3JrIG9ubHkgYWZ0ZXIgbGlmZWN5Y2xlIHByZXBhcmF0aW9uIGhhcyBjb21wbGV0ZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIEN1cnJlbnQgb3IgbmV3bHkgc3RhcnRlZCBjb29yZGluYXRvciBmbGlnaHQuXG4gICAqL1xuICBfc3RhcnRSZXF1ZXN0ZWRSdW4oKSB7XG4gICAgaWYgKCF0aGlzLl9hY3RpdmUpIHJldHVybiBQcm9taXNlLnJlc29sdmUoKVxuICAgIGlmICh0aGlzLl9yZXRyeVRpbWVyICE9PSBudWxsKSByZXR1cm4gdGhpcy5fcnVuUHJvbWlzZSB8fCBQcm9taXNlLnJlc29sdmUoKVxuICAgIGlmICghdGhpcy5fcnVuUHJvbWlzZSkge1xuICAgICAgY29uc3QgZ2VuZXJhdGlvbiA9IHRoaXMuX2dlbmVyYXRpb25cblxuICAgICAgdGhpcy5fcnVuUHJvbWlzZSA9IHRoaXMuX2RyYWluKGdlbmVyYXRpb24pLmZpbmFsbHkoKCkgPT4ge1xuICAgICAgICB0aGlzLl9ydW5Qcm9taXNlID0gbnVsbFxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fcnVuUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIENsZWFycyBiYWNrb2ZmIGFuZCByZXF1ZXN0cyBvbmUgc2luZ2xlLWZsaWdodCB1c2VyIHJldHJ5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgcmV0cnkgY3ljbGUgZHJhaW5zLlxuICAgKi9cbiAgcmV0cnkoKSB7XG4gICAgaWYgKCF0aGlzLl9hY3RpdmUpIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCByZXRyeSBhIHN0b3BwZWQgU3luY0Nvb3JkaW5hdG9yXCIpXG5cbiAgICB0aGlzLl9jbGVhclJldHJ5VGltZXIoKVxuICAgIHRoaXMuX2F0dGVtcHQgPSAwXG5cbiAgICByZXR1cm4gdGhpcy50cmlnZ2VyKFwibWFudWFsLXJldHJ5XCIpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgb25lIGR1cmFibGUgY29uZmxpY3QgdGhyb3VnaCBTeW5jQ2xpZW50LCB0aGVuIHJlZnJlc2hlcyBzdGF0dXMgYW5kXG4gICAqIHJlcGxheXMgcmV0cnktbG9jYWwgaW50ZW50IHRocm91Z2ggdGhlIHNhbWUgY3ljbGUuXG4gICAqIEBwYXJhbSB7e3JlY29yZElkOiBzdHJpbmcsIHJlc29sdXRpb246IFwia2VlcC1zZXJ2ZXJcIiB8IFwicmV0cnktbG9jYWxcIiwgcmVzb3VyY2VUeXBlOiBzdHJpbmd9fSBhcmdzIC0gRXhwbGljaXQgcmVzb2x1dGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcmVzb2x1dGlvbiBzdGF0ZSBpcyByZWZyZXNoZWQuXG4gICAqL1xuICBhc3luYyByZXNvbHZlQ29uZmxpY3QoYXJncykge1xuICAgIGlmICghdGhpcy5fYWN0aXZlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgcmVzb2x2ZSBhIGNvbmZsaWN0IG9uIGEgc3RvcHBlZCBTeW5jQ29vcmRpbmF0b3JcIilcblxuICAgIGF3YWl0IHRoaXMuc3luY0NsaWVudC5yZXNvbHZlQ29uZmxpY3QoYXJncylcbiAgICB0aGlzLl9jbGVhclJldHJ5VGltZXIoKVxuICAgIHRoaXMuX2F0dGVtcHQgPSAwXG4gICAgYXdhaXQgdGhpcy50cmlnZ2VyKFwiY29uZmxpY3QtcmVzb2x1dGlvblwiKVxuICB9XG5cbiAgLyoqXG4gICAqIERyYWlucyByZXF1ZXN0ZWQgd29yayBzZXJpYWxseSBmb3Igb25lIGxpZmVjeWNsZSBnZW5lcmF0aW9uLlxuICAgKiBAcGFyYW0ge251bWJlcn0gZ2VuZXJhdGlvbiAtIE93bmluZyBnZW5lcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIG5vIGltbWVkaWF0ZSByZXJ1biByZW1haW5zLlxuICAgKi9cbiAgYXN5bmMgX2RyYWluKGdlbmVyYXRpb24pIHtcbiAgICB3aGlsZSAodGhpcy5fcmVydW5SZXF1ZXN0ZWQgJiYgdGhpcy5fb3duc0dlbmVyYXRpb24oZ2VuZXJhdGlvbikpIHtcbiAgICAgIHRoaXMuX3JlcnVuUmVxdWVzdGVkID0gZmFsc2VcbiAgICAgIGNvbnN0IGNvbXBsZXRlZCA9IGF3YWl0IHRoaXMuX3J1bkN5Y2xlKGdlbmVyYXRpb24pXG5cbiAgICAgIGlmICghY29tcGxldGVkKSB0aGlzLl9yZXJ1blJlcXVlc3RlZCA9IGZhbHNlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb25lIHJlcGxheSwgcmVhbHRpbWUtc3Vic2NyaWJlLCBhbmQgcHVsbCBjeWNsZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGdlbmVyYXRpb24gLSBPd25pbmcgZ2VuZXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBhbiBpbW1lZGlhdGUgcXVldWVkIHJlcnVuIG1heSBwcm9jZWVkLlxuICAgKi9cbiAgYXN5bmMgX3J1bkN5Y2xlKGdlbmVyYXRpb24pIHtcbiAgICB0cnkge1xuICAgICAgaWYgKCFhd2FpdCB0aGlzLnN5bmNDbGllbnQuaXNPbmxpbmUoKSkge1xuICAgICAgICBjb25zdCBpbnNwZWN0aW9uID0gYXdhaXQgdGhpcy5zeW5jQ2xpZW50Lmluc3BlY3RTeW5jU3RhdGUoKVxuXG4gICAgICAgIHRoaXMuX2Fzc2VydEFjdGl2ZShnZW5lcmF0aW9uKVxuICAgICAgICB0aGlzLl9wdWJsaXNoKHsuLi50aGlzLl9zdGF0dXMsIC4uLmluc3BlY3Rpb24sIGZhaWx1cmU6IG51bGwsIG5leHRSZXRyeUF0OiBudWxsLCBzdGF0ZTogXCJvZmZsaW5lXCJ9KVxuICAgICAgICBhd2FpdCB0aGlzLl9wZXJzaXN0U3RhdHVzKGdlbmVyYXRpb24pXG5cbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG5cbiAgICAgIHRoaXMuX3B1Ymxpc2goey4uLnRoaXMuX3N0YXR1cywgbmV4dFJldHJ5QXQ6IG51bGwsIHN0YXRlOiBcInN5bmNpbmdcIn0pXG4gICAgICBhd2FpdCB0aGlzLnN5bmNDbGllbnQucmVwbGF5UGVuZGluZygpXG4gICAgICB0aGlzLl9hc3NlcnRBY3RpdmUoZ2VuZXJhdGlvbilcbiAgICAgIGlmICh0aGlzLnJlYWx0aW1lKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuc3luY0NsaWVudC5zdWJzY3JpYmVSZWFsdGltZSgpXG4gICAgICAgIHRoaXMuX2Fzc2VydEFjdGl2ZShnZW5lcmF0aW9uKVxuICAgICAgfVxuICAgICAgYXdhaXQgdGhpcy5zeW5jQ2xpZW50LnB1bGwoKVxuICAgICAgdGhpcy5fYXNzZXJ0QWN0aXZlKGdlbmVyYXRpb24pXG5cbiAgICAgIGNvbnN0IGluc3BlY3Rpb24gPSBhd2FpdCB0aGlzLnN5bmNDbGllbnQuaW5zcGVjdFN5bmNTdGF0ZSgpXG5cbiAgICAgIHRoaXMuX2Fzc2VydEFjdGl2ZShnZW5lcmF0aW9uKVxuICAgICAgdGhpcy5fcHVibGlzaCh7XG4gICAgICAgIC4uLnRoaXMuX3N0YXR1cyxcbiAgICAgICAgLi4uaW5zcGVjdGlvbixcbiAgICAgICAgZmFpbHVyZTogbnVsbCxcbiAgICAgICAgbGFzdFN1Y2Nlc3NBdDogdGhpcy5fbm93SXNvKCksXG4gICAgICAgIG5leHRSZXRyeUF0OiBudWxsLFxuICAgICAgICBzdGF0ZTogaW5zcGVjdGlvblN0YXRlKGluc3BlY3Rpb24pXG4gICAgICB9KVxuICAgICAgYXdhaXQgdGhpcy5fcGVyc2lzdFN0YXR1cyhnZW5lcmF0aW9uKVxuICAgICAgdGhpcy5fYXR0ZW1wdCA9IDBcblxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKCF0aGlzLl9vd25zR2VuZXJhdGlvbihnZW5lcmF0aW9uKSB8fCB0aGlzLmlzTGlmZWN5Y2xlQWJvcnQoZXJyb3IpIHx8IHRoaXMuc3luY0NsaWVudC5pc0xpZmVjeWNsZUFib3J0KGVycm9yKSkgcmV0dXJuIGZhbHNlXG5cbiAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZUZhaWx1cmUoLyoqIEB0eXBlIHtFcnJvcn0gKi8gKGVycm9yKSwgZ2VuZXJhdGlvbilcblxuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFB1Ymxpc2hlcyBhIGNsYXNzaWZpZWQgZmFpbHVyZSBhbmQgb3ducyBpdHMgYm91bmRlZCByZXRyeSB0aW1lci5cbiAgICogQHBhcmFtIHtFcnJvcn0gZXJyb3IgLSBDeWNsZSBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge251bWJlcn0gZ2VuZXJhdGlvbiAtIE93bmluZyBnZW5lcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBzdGF0dXMgcGVyc2lzdGVuY2UgYW5kIHNjaGVkdWxpbmcuXG4gICAqL1xuICBhc3luYyBfaGFuZGxlRmFpbHVyZShlcnJvciwgZ2VuZXJhdGlvbikge1xuICAgIHRoaXMuX2F0dGVtcHQgKz0gMVxuICAgIGxldCBjbGFzc2lmaWVkID0gbm9ybWFsaXplRXJyb3JDbGFzc2lmaWNhdGlvbih0aGlzLmNsYXNzaWZ5RXJyb3IoZXJyb3IpKVxuICAgIGNvbnN0IGZhaWxlZEF0ID0gdGhpcy5fbm93SXNvKClcbiAgICBsZXQgZmFpbHVyZVN0YXR1cyA9IGZhaWx1cmVTdGF0dXNGb3Ioe2F0dGVtcHQ6IHRoaXMuX2F0dGVtcHQsIGNsYXNzaWZpZWQsIGZhaWxlZEF0LCByZXRyeVBvbGljeTogdGhpcy5yZXRyeVBvbGljeSwgc3RhdHVzOiB0aGlzLl9zdGF0dXN9KVxuXG4gICAgdGhpcy5fcHVibGlzaChmYWlsdXJlU3RhdHVzLnN0YXR1cylcblxuICAgIGlmICh0aGlzLnN0YXR1c1N0b3JlKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLnN0YXR1c1N0b3JlLnNhdmUodGhpcy5fc3RhdHVzKVxuICAgICAgICB0aGlzLl9hc3NlcnRBY3RpdmUoZ2VuZXJhdGlvbilcbiAgICAgIH0gY2F0Y2ggKHBlcnNpc3RlbmNlRXJyb3IpIHtcbiAgICAgICAgY2xhc3NpZmllZCA9IG5vcm1hbGl6ZUVycm9yQ2xhc3NpZmljYXRpb24odGhpcy5jbGFzc2lmeUVycm9yKC8qKiBAdHlwZSB7RXJyb3J9ICovIChwZXJzaXN0ZW5jZUVycm9yKSkpXG4gICAgICAgIGZhaWx1cmVTdGF0dXMgPSBmYWlsdXJlU3RhdHVzRm9yKHthdHRlbXB0OiB0aGlzLl9hdHRlbXB0LCBjbGFzc2lmaWVkLCBmYWlsZWRBdCwgcmV0cnlQb2xpY3k6IHRoaXMucmV0cnlQb2xpY3ksIHN0YXR1czogdGhpcy5fc3RhdHVzfSlcbiAgICAgICAgdGhpcy5fcHVibGlzaChmYWlsdXJlU3RhdHVzLnN0YXR1cylcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZmFpbHVyZVN0YXR1cy5kZWxheU1zID09PSBudWxsKSByZXR1cm5cblxuICAgIHRoaXMuX2Fzc2VydEFjdGl2ZShnZW5lcmF0aW9uKVxuICAgIHRoaXMuX3JldHJ5VGltZXIgPSB0aGlzLnNjaGVkdWxlci5zZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMuX3JldHJ5VGltZXIgPSBudWxsXG4gICAgICBpZiAoIXRoaXMuX293bnNHZW5lcmF0aW9uKGdlbmVyYXRpb24pKSByZXR1cm5cblxuICAgICAgdm9pZCB0aGlzLnRyaWdnZXIoXCJhdXRvbWF0aWMtcmV0cnlcIilcbiAgICB9LCBmYWlsdXJlU3RhdHVzLmRlbGF5TXMpXG4gIH1cblxuICAvKipcbiAgICogUGVyc2lzdHMgdGhlIGN1cnJlbnQgc2FmZSBzdGF0dXMgZm9yIGFuIGFjdGl2ZSBnZW5lcmF0aW9uLlxuICAgKiBAcGFyYW0ge251bWJlcn0gZ2VuZXJhdGlvbiAtIE93bmluZyBnZW5lcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBwZXJzaXN0ZW5jZS5cbiAgICovXG4gIGFzeW5jIF9wZXJzaXN0U3RhdHVzKGdlbmVyYXRpb24pIHtcbiAgICBpZiAodGhpcy5zdGF0dXNTdG9yZSkgYXdhaXQgdGhpcy5zdGF0dXNTdG9yZS5zYXZlKHRoaXMuX3N0YXR1cylcbiAgICB0aGlzLl9hc3NlcnRBY3RpdmUoZ2VuZXJhdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBDb2FsZXNjZXMgb25lIGNvbm5lY3Rpdml0eSBjaGFuZ2UgaW50byB0aGUgY29vcmRpbmF0b3IgY3ljbGUuXG4gICAqIEBwYXJhbSB7e2dlbmVyYXRpb246IG51bWJlciwgb25saW5lOiBib29sZWFufX0gYXJncyAtIENvbm5lY3Rpdml0eSBldmVudC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfY29ubmVjdGl2aXR5Q2hhbmdlZCh7Z2VuZXJhdGlvbiwgb25saW5lfSkge1xuICAgIGlmICghdGhpcy5fb3duc0dlbmVyYXRpb24oZ2VuZXJhdGlvbikpIHJldHVyblxuXG4gICAgdGhpcy5fY2xlYXJSZXRyeVRpbWVyKClcbiAgICBpZiAob25saW5lKSB0aGlzLl9hdHRlbXB0ID0gMFxuICAgIHZvaWQgdGhpcy50cmlnZ2VyKG9ubGluZSA/IFwiY29ubmVjdGl2aXR5LW9ubGluZVwiIDogXCJjb25uZWN0aXZpdHktb2ZmbGluZVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIENsZWFycyB0aGUgY3VycmVudGx5IG93bmVkIHJldHJ5IHRpbWVyLCBpZiBwcmVzZW50LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9jbGVhclJldHJ5VGltZXIoKSB7XG4gICAgaWYgKHRoaXMuX3JldHJ5VGltZXIgPT09IG51bGwpIHJldHVyblxuXG4gICAgdGhpcy5zY2hlZHVsZXIuY2xlYXJUaW1lb3V0KHRoaXMuX3JldHJ5VGltZXIpXG4gICAgdGhpcy5fcmV0cnlUaW1lciA9IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3Mgd2hldGhlciBhIGxpZmVjeWNsZSBnZW5lcmF0aW9uIHN0aWxsIG93bnMgc3RhdGUgdXBkYXRlcy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGdlbmVyYXRpb24gLSBFeHBlY3RlZCBnZW5lcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBnZW5lcmF0aW9uIGlzIGN1cnJlbnQgYW5kIGFjdGl2ZS5cbiAgICovXG4gIF9vd25zR2VuZXJhdGlvbihnZW5lcmF0aW9uKSB7XG4gICAgcmV0dXJuIHRoaXMuX2FjdGl2ZSAmJiB0aGlzLl9nZW5lcmF0aW9uID09PSBnZW5lcmF0aW9uXG4gIH1cblxuICAvKipcbiAgICogRmFpbHMgd2hlbiB3b3JrIG5vIGxvbmdlciBiZWxvbmdzIHRvIHRoZSBhY3RpdmUgZ2VuZXJhdGlvbi5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGdlbmVyYXRpb24gLSBFeHBlY3RlZCBnZW5lcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9hc3NlcnRBY3RpdmUoZ2VuZXJhdGlvbikge1xuICAgIGlmICh0aGlzLl9vd25zR2VuZXJhdGlvbihnZW5lcmF0aW9uKSkgcmV0dXJuXG5cbiAgICB0aHJvdyBuZXcgU3luY0Nvb3JkaW5hdG9yTGlmZWN5Y2xlQWJvcnRFcnJvcihcIlN5bmMgY29vcmRpbmF0b3Igd29yayBiZWxvbmdzIHRvIGFuIGluYWN0aXZlIGdlbmVyYXRpb25cIilcbiAgfVxuXG4gIC8qKlxuICAgKiBJZGVudGlmaWVzIGNvb3JkaW5hdG9yLW93bmVkIGNvb3BlcmF0aXZlIGNhbmNlbGxhdGlvbi5cbiAgICogQHBhcmFtIHt1bmtub3dufSBlcnJvciAtIENhbmRpZGF0ZSBlcnJvci5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGlzIGNvb3JkaW5hdG9yIGNyZWF0ZWQgdGhlIGFib3J0IGVycm9yLlxuICAgKi9cbiAgaXNMaWZlY3ljbGVBYm9ydChlcnJvcikge1xuICAgIHJldHVybiBlcnJvciBpbnN0YW5jZW9mIFN5bmNDb29yZGluYXRvckxpZmVjeWNsZUFib3J0RXJyb3JcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyBhbmQgdmFsaWRhdGVzIHRoZSBpbmplY3RlZCBjbG9jay5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBWYWxpZCBJU08gY2xvY2sgdmFsdWUuXG4gICAqL1xuICBfbm93SXNvKCkge1xuICAgIGNvbnN0IHZhbHVlID0gdGhpcy5ub3coKVxuXG4gICAgaWYgKCEodmFsdWUgaW5zdGFuY2VvZiBEYXRlKSB8fCBOdW1iZXIuaXNOYU4odmFsdWUuZ2V0VGltZSgpKSkgdGhyb3cgbmV3IEVycm9yKFwiU3luY0Nvb3JkaW5hdG9yIG5vdygpIG11c3QgcmV0dXJuIGEgdmFsaWQgRGF0ZVwiKVxuXG4gICAgcmV0dXJuIHZhbHVlLnRvSVNPU3RyaW5nKClcbiAgfVxuXG4gIC8qKlxuICAgKiBGcmVlemVzIGFuZCBwdWJsaXNoZXMgYSBuZXcgb2JzZXJ2YWJsZSBzbmFwc2hvdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtY29vcmRpbmF0b3ItdHlwZXMuanNcIikuU3luY0Nvb3JkaW5hdG9yU3RhdHVzfSBzdGF0dXMgLSBOZXcgc3RhdHVzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9wdWJsaXNoKHN0YXR1cykge1xuICAgIHRoaXMuX3N0YXR1cyA9IGltbXV0YWJsZVN0YXR1cyhzdGF0dXMpXG5cbiAgICBmb3IgKGNvbnN0IGxpc3RlbmVyIG9mIHRoaXMuX2xpc3RlbmVycykgbGlzdGVuZXIodGhpcy5fc3RhdHVzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGN1cnJlbnQgb2JzZXJ2YWJsZSBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vc3luYy1jb29yZGluYXRvci10eXBlcy5qc1wiKS5TeW5jQ29vcmRpbmF0b3JTdGF0dXN9IC0gQ3VycmVudCBpbW11dGFibGUgc25hcHNob3QuXG4gICAqL1xuICBzdGF0dXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3N0YXR1c1xuICB9XG5cbiAgLyoqXG4gICAqIE9ic2VydmVzIHN0YXR1cyBhbmQgcmVjZWl2ZXMgdGhlIGN1cnJlbnQgc25hcHNob3QgaW1tZWRpYXRlbHkuXG4gICAqIEBwYXJhbSB7KHN0YXR1czogaW1wb3J0KFwiLi9zeW5jLWNvb3JkaW5hdG9yLXR5cGVzLmpzXCIpLlN5bmNDb29yZGluYXRvclN0YXR1cykgPT4gdm9pZH0gbGlzdGVuZXIgLSBPYnNlcnZlci5cbiAgICogQHJldHVybnMgeygpID0+IHZvaWR9IC0gSWRlbXBvdGVudCB1bnN1YnNjcmliZS5cbiAgICovXG4gIHN1YnNjcmliZShsaXN0ZW5lcikge1xuICAgIHJlcXVpcmVGdW5jdGlvbihsaXN0ZW5lciwgXCJzdGF0dXMgbGlzdGVuZXJcIilcbiAgICB0aGlzLl9saXN0ZW5lcnMuYWRkKGxpc3RlbmVyKVxuICAgIGxpc3RlbmVyKHRoaXMuX3N0YXR1cylcblxuICAgIHJldHVybiAoKSA9PiB0aGlzLl9saXN0ZW5lcnMuZGVsZXRlKGxpc3RlbmVyKVxuICB9XG5cbiAgLyoqXG4gICAqIEF3YWl0cyBvbmx5IHRoZSBhY3RpdmUgb3IgcXVldWVkIGN5Y2xlLCBub3QgYSBmdXR1cmUgYmFja29mZiB0aW1lci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjdXJyZW50IHdvcmsgZHJhaW5zLlxuICAgKi9cbiAgYXN5bmMgd2FpdEZvckN1cnJlbnRSdW4oKSB7XG4gICAgd2hpbGUgKHRoaXMuX3J1blByb21pc2UpIGF3YWl0IHRoaXMuX3J1blByb21pc2VcbiAgfVxufVxuXG4vKipcbiAqIEJ1aWxkcyB0aGUgZGVmYXVsdCBnbG9iYWwgdGltZXIgYWRhcHRlci5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3N5bmMtY29vcmRpbmF0b3ItdHlwZXMuanNcIikuU3luY0Nvb3JkaW5hdG9yU2NoZWR1bGVyfSAtIEdsb2JhbCB0aW1lciBhZGFwdGVyLlxuICovXG5mdW5jdGlvbiBkZWZhdWx0U2NoZWR1bGVyKCkge1xuICByZXR1cm4ge1xuICAgIGNsZWFyVGltZW91dDogKHRpbWVyKSA9PiBnbG9iYWxUaGlzLmNsZWFyVGltZW91dCgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+fSAqLyAodGltZXIpKSxcbiAgICBzZXRUaW1lb3V0OiAoY2FsbGJhY2ssIGRlbGF5TXMpID0+IGdsb2JhbFRoaXMuc2V0VGltZW91dChjYWxsYmFjaywgZGVsYXlNcylcbiAgfVxufVxuXG4vKipcbiAqIFZhbGlkYXRlcyBhbmQgZmlsbHMgcmV0cnkgcG9saWN5IGRlZmF1bHRzLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSByZXRyeSAtIFJldHJ5IG92ZXJyaWRlcy5cbiAqIEByZXR1cm5zIHt7aW5pdGlhbERlbGF5TXM6IG51bWJlciwgbWF4QXR0ZW1wdHM6IG51bWJlciwgbWF4RGVsYXlNczogbnVtYmVyfX0gLSBDb21wbGV0ZSBwb2xpY3kuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZVJldHJ5UG9saWN5KHJldHJ5KSB7XG4gIGNvbnN0IHBvbGljeSA9IHsuLi5ERUZBVUxUX1JFVFJZLCAuLi5yZXRyeX1cblxuICBmb3IgKGNvbnN0IFtuYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMocG9saWN5KSkge1xuICAgIGlmICghTnVtYmVyLmlzSW50ZWdlcih2YWx1ZSkgfHwgdmFsdWUgPCAxKSB0aHJvdyBuZXcgRXJyb3IoYFN5bmNDb29yZGluYXRvciByZXRyeS4ke25hbWV9IG11c3QgYmUgYSBwb3NpdGl2ZSBpbnRlZ2VyYClcbiAgfVxuICBpZiAocG9saWN5Lm1heERlbGF5TXMgPCBwb2xpY3kuaW5pdGlhbERlbGF5TXMpIHRocm93IG5ldyBFcnJvcihcIlN5bmNDb29yZGluYXRvciByZXRyeS5tYXhEZWxheU1zIG11c3QgYmUgZ3JlYXRlciB0aGFuIG9yIGVxdWFsIHRvIGluaXRpYWxEZWxheU1zXCIpXG5cbiAgcmV0dXJuIHBvbGljeVxufVxuXG4vKipcbiAqIENsYXNzaWZpZXMgdW5rbm93biBlcnJvcnMgYXMgcGVybWFuZW50IHdpdGhvdXQgZXhwb3NpbmcgdGhlaXIgbWVzc2FnZXMuXG4gKiBAcGFyYW0ge0Vycm9yfSBfZXJyb3IgLSBVbmNsYXNzaWZpZWQgZXJyb3IuXG4gKiBAcmV0dXJucyB7e2NvZGU6IHN0cmluZywgcmV0cnlhYmxlOiBib29sZWFufX0gLSBTYWZlIGRlZmF1bHQgY2xhc3NpZmljYXRpb24uXG4gKi9cbmZ1bmN0aW9uIGRlZmF1bHRFcnJvckNsYXNzaWZpY2F0aW9uKF9lcnJvcikge1xuICByZXR1cm4ge2NvZGU6IFwic3luY19mYWlsZWRcIiwgcmV0cnlhYmxlOiBmYWxzZX1cbn1cblxuLyoqXG4gKiBWYWxpZGF0ZXMgYXBwbGljYXRpb24tcHJvdmlkZWQgc2FmZSBlcnJvciBtZXRhZGF0YS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgZGVmYXVsdEVycm9yQ2xhc3NpZmljYXRpb24+ICYge21lc3NhZ2U/OiBzdHJpbmd9fSBjbGFzc2lmaWNhdGlvbiAtIFJhdyBjbGFzc2lmaWNhdGlvbi5cbiAqIEByZXR1cm5zIHt7Y29kZTogc3RyaW5nLCBtZXNzYWdlPzogc3RyaW5nLCByZXRyeWFibGU6IGJvb2xlYW59fSAtIFZhbGlkYXRlZCBjbGFzc2lmaWNhdGlvbi5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRXJyb3JDbGFzc2lmaWNhdGlvbihjbGFzc2lmaWNhdGlvbikge1xuICBpZiAoIWNsYXNzaWZpY2F0aW9uIHx8IHR5cGVvZiBjbGFzc2lmaWNhdGlvbiAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGNsYXNzaWZpY2F0aW9uKSkgdGhyb3cgbmV3IEVycm9yKFwiU3luY0Nvb3JkaW5hdG9yIGNsYXNzaWZ5RXJyb3IgbXVzdCByZXR1cm4gYW4gb2JqZWN0XCIpXG4gIGlmICh0eXBlb2YgY2xhc3NpZmljYXRpb24uY29kZSAhPT0gXCJzdHJpbmdcIiB8fCBjbGFzc2lmaWNhdGlvbi5jb2RlLmxlbmd0aCA9PT0gMCkgdGhyb3cgbmV3IEVycm9yKFwiU3luY0Nvb3JkaW5hdG9yIGVycm9yIGNsYXNzaWZpY2F0aW9uIGNvZGUgbXVzdCBiZSBhIG5vbi1lbXB0eSBzdHJpbmdcIilcbiAgaWYgKHR5cGVvZiBjbGFzc2lmaWNhdGlvbi5yZXRyeWFibGUgIT09IFwiYm9vbGVhblwiKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ29vcmRpbmF0b3IgZXJyb3IgY2xhc3NpZmljYXRpb24gcmV0cnlhYmxlIG11c3QgYmUgYm9vbGVhblwiKVxuICBpZiAoY2xhc3NpZmljYXRpb24ubWVzc2FnZSAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBjbGFzc2lmaWNhdGlvbi5tZXNzYWdlICE9PSBcInN0cmluZ1wiKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ29vcmRpbmF0b3IgZXJyb3IgY2xhc3NpZmljYXRpb24gbWVzc2FnZSBtdXN0IGJlIGEgc3RyaW5nXCIpXG5cbiAgcmV0dXJuIGNsYXNzaWZpY2F0aW9uXG59XG5cbi8qKlxuICogQnVpbGRzIG9uZSBmYWlsdXJlIHNuYXBzaG90IGFuZCBpdHMgb3B0aW9uYWwgYXV0b21hdGljLXJldHJ5IGRlbGF5LlxuICogQHBhcmFtIHt7YXR0ZW1wdDogbnVtYmVyLCBjbGFzc2lmaWVkOiB7Y29kZTogc3RyaW5nLCBtZXNzYWdlPzogc3RyaW5nLCByZXRyeWFibGU6IGJvb2xlYW59LCBmYWlsZWRBdDogc3RyaW5nLCByZXRyeVBvbGljeToge2luaXRpYWxEZWxheU1zOiBudW1iZXIsIG1heEF0dGVtcHRzOiBudW1iZXIsIG1heERlbGF5TXM6IG51bWJlcn0sIHN0YXR1czogaW1wb3J0KFwiLi9zeW5jLWNvb3JkaW5hdG9yLXR5cGVzLmpzXCIpLlN5bmNDb29yZGluYXRvclN0YXR1c319IGFyZ3MgLSBGYWlsdXJlIHN0YXRlLlxuICogQHJldHVybnMge3tkZWxheU1zOiBudW1iZXIgfCBudWxsLCBzdGF0dXM6IGltcG9ydChcIi4vc3luYy1jb29yZGluYXRvci10eXBlcy5qc1wiKS5TeW5jQ29vcmRpbmF0b3JTdGF0dXN9fSAtIEZhaWx1cmUgc25hcHNob3QgYW5kIHJldHJ5IGRlbGF5LlxuICovXG5mdW5jdGlvbiBmYWlsdXJlU3RhdHVzRm9yKHthdHRlbXB0LCBjbGFzc2lmaWVkLCBmYWlsZWRBdCwgcmV0cnlQb2xpY3ksIHN0YXR1c30pIHtcbiAgY29uc3QgcmV0cnlhYmxlID0gY2xhc3NpZmllZC5yZXRyeWFibGUgJiYgYXR0ZW1wdCA8IHJldHJ5UG9saWN5Lm1heEF0dGVtcHRzXG4gIGNvbnN0IGRlbGF5TXMgPSByZXRyeWFibGUgPyBNYXRoLm1pbihyZXRyeVBvbGljeS5pbml0aWFsRGVsYXlNcyAqICgyICoqIChhdHRlbXB0IC0gMSkpLCByZXRyeVBvbGljeS5tYXhEZWxheU1zKSA6IG51bGxcbiAgY29uc3QgZmFpbHVyZSA9IHtcbiAgICBhdHRlbXB0LFxuICAgIGF0OiBmYWlsZWRBdCxcbiAgICBjb2RlOiBjbGFzc2lmaWVkLmNvZGUsXG4gICAgLi4uKGNsYXNzaWZpZWQubWVzc2FnZSA9PT0gdW5kZWZpbmVkID8ge30gOiB7bWVzc2FnZTogY2xhc3NpZmllZC5tZXNzYWdlfSksXG4gICAgcmV0cnlhYmxlOiBjbGFzc2lmaWVkLnJldHJ5YWJsZVxuICB9XG4gIGNvbnN0IG5leHRSZXRyeUF0ID0gZGVsYXlNcyA9PT0gbnVsbCA/IG51bGwgOiBuZXcgRGF0ZShuZXcgRGF0ZShmYWlsZWRBdCkuZ2V0VGltZSgpICsgZGVsYXlNcykudG9JU09TdHJpbmcoKVxuXG4gIHJldHVybiB7XG4gICAgZGVsYXlNcyxcbiAgICBzdGF0dXM6IGltbXV0YWJsZVN0YXR1cyh7Li4uc3RhdHVzLCBmYWlsdXJlLCBuZXh0UmV0cnlBdCwgc3RhdGU6IHJldHJ5YWJsZSA/IFwiYmFja29mZlwiIDogXCJmYWlsZWRcIn0pXG4gIH1cbn1cblxuLyoqXG4gKiBNYXBzIGR1cmFibGUgcXVldWUgc3RhdGUgdG8gYW4gb2JzZXJ2YWJsZSByZXN0aW5nIHN0YXRlLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtY29vcmRpbmF0b3ItdHlwZXMuanNcIikuU3luY0NsaWVudEluc3BlY3Rpb259IGluc3BlY3Rpb24gLSBEdXJhYmxlIGluc3BlY3Rpb24uXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9zeW5jLWNvb3JkaW5hdG9yLXR5cGVzLmpzXCIpLlN5bmNDb29yZGluYXRvclN0YXRlfSAtIFJlc3Rpbmcgc3RhdGUuXG4gKi9cbmZ1bmN0aW9uIGluc3BlY3Rpb25TdGF0ZShpbnNwZWN0aW9uKSB7XG4gIGlmIChpbnNwZWN0aW9uLmNvbmZsaWN0cy5sZW5ndGggPiAwKSByZXR1cm4gXCJjb25mbGljdGVkXCJcbiAgaWYgKGluc3BlY3Rpb24ucmVqZWN0ZWRDb3VudCA+IDApIHJldHVybiBcImZhaWxlZFwiXG4gIGlmIChpbnNwZWN0aW9uLnBlbmRpbmdDb3VudCA+IDApIHJldHVybiBcInBlbmRpbmdcIlxuXG4gIHJldHVybiBcImlkbGVcIlxufVxuXG4vKipcbiAqIFJlbW92ZXMgc3RhbGUgaW4tZmxpZ2h0IHRpbWluZyBmcm9tIGEgcmVzdG9yZWQgc3RhdHVzIHNuYXBzaG90LlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtY29vcmRpbmF0b3ItdHlwZXMuanNcIikuU3luY0Nvb3JkaW5hdG9yU3RhdHVzfSBzdGF0dXMgLSBTdG9yZWQgc3RhdHVzLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vc3luYy1jb29yZGluYXRvci10eXBlcy5qc1wiKS5TeW5jQ29vcmRpbmF0b3JTdGF0dXN9IC0gUmVzdG9yZWQgb2JzZXJ2YWJsZSBzdGF0dXMuXG4gKi9cbmZ1bmN0aW9uIHJlc3RvcmVkU3RhdHVzKHN0YXR1cykge1xuICBpZiAoIUNPT1JESU5BVE9SX1NUQVRFUy5oYXMoc3RhdHVzLnN0YXRlKSkgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIHBlcnNpc3RlZCBTeW5jQ29vcmRpbmF0b3Igc3RhdGU6ICR7U3RyaW5nKHN0YXR1cy5zdGF0ZSl9YClcblxuICByZXR1cm4ge1xuICAgIGNvbmZsaWN0czogc3RhdHVzLmNvbmZsaWN0cyxcbiAgICBmYWlsdXJlOiBzdGF0dXMuZmFpbHVyZSxcbiAgICBsYXN0U3VjY2Vzc0F0OiBzdGF0dXMubGFzdFN1Y2Nlc3NBdCxcbiAgICBuZXh0UmV0cnlBdDogbnVsbCxcbiAgICBwZW5kaW5nQ291bnQ6IHN0YXR1cy5wZW5kaW5nQ291bnQsXG4gICAgcmVqZWN0ZWRDb3VudDogc3RhdHVzLnJlamVjdGVkQ291bnQsXG4gICAgc3RhdGU6IHN0YXR1cy5zdGF0ZSA9PT0gXCJzeW5jaW5nXCIgfHwgc3RhdHVzLnN0YXRlID09PSBcImJhY2tvZmZcIiA/IGluc3BlY3Rpb25TdGF0ZShzdGF0dXMpIDogc3RhdHVzLnN0YXRlXG4gIH1cbn1cblxuLyoqXG4gKiBEZWVwLWZyZWV6ZXMgdGhlIHN0YXR1cy1vd25lZCBkaWFnbm9zdGljIGNvbGxlY3Rpb25zLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtY29vcmRpbmF0b3ItdHlwZXMuanNcIikuU3luY0Nvb3JkaW5hdG9yU3RhdHVzfSBzdGF0dXMgLSBTbmFwc2hvdC5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3N5bmMtY29vcmRpbmF0b3ItdHlwZXMuanNcIikuU3luY0Nvb3JkaW5hdG9yU3RhdHVzfSAtIEltbXV0YWJsZSBzbmFwc2hvdC5cbiAqL1xuZnVuY3Rpb24gaW1tdXRhYmxlU3RhdHVzKHN0YXR1cykge1xuICBjb25zdCBjb25mbGljdHMgPSBzdGF0dXMuY29uZmxpY3RzLm1hcCgoY29uZmxpY3QpID0+IE9iamVjdC5mcmVlemUoey4uLmNvbmZsaWN0fSkpXG4gIGNvbnN0IGZhaWx1cmUgPSBzdGF0dXMuZmFpbHVyZSA/IE9iamVjdC5mcmVlemUoey4uLnN0YXR1cy5mYWlsdXJlfSkgOiBudWxsXG5cbiAgcmV0dXJuIE9iamVjdC5mcmVlemUoey4uLnN0YXR1cywgY29uZmxpY3RzOiBPYmplY3QuZnJlZXplKGNvbmZsaWN0cyksIGZhaWx1cmV9KVxufVxuXG4vKipcbiAqIFZhbGlkYXRlcyBvbmUgcmVxdWlyZWQgY2FsbGJhY2suXG4gKiBAcGFyYW0ge3Vua25vd259IHZhbHVlIC0gRnVuY3Rpb24gY2FuZGlkYXRlLlxuICogQHBhcmFtIHtzdHJpbmd9IGxhYmVsIC0gQ29udHJhY3QgbGFiZWwuXG4gKiBAcmV0dXJucyB7dm9pZH0gLSBWYWxpZGF0ZXMgdGhlIGZ1bmN0aW9uIGNhbmRpZGF0ZS5cbiAqL1xuZnVuY3Rpb24gcmVxdWlyZUZ1bmN0aW9uKHZhbHVlLCBsYWJlbCkge1xuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcihgU3luY0Nvb3JkaW5hdG9yICR7bGFiZWx9IG11c3QgYmUgYSBmdW5jdGlvbmApXG59XG5cbi8qKlxuICogVmFsaWRhdGVzIHRoZSBTeW5jQ2xpZW50IHN1cmZhY2UgcmVxdWlyZWQgYnkgdGhlIGNvb3JkaW5hdG9yLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtY2xpZW50LmpzXCIpLmRlZmF1bHR9IGNsaWVudCAtIENsaWVudC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiByZXF1aXJlQ29vcmRpbmF0b3JDbGllbnQoY2xpZW50KSB7XG4gIGlmICghY2xpZW50KSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ29vcmRpbmF0b3IgcmVxdWlyZXMgYSBTeW5jQ2xpZW50XCIpXG5cbiAgcmVxdWlyZUZ1bmN0aW9uKGNsaWVudC5hdHRhY2hDb29yZGluYXRvciwgXCJzeW5jQ2xpZW50LmF0dGFjaENvb3JkaW5hdG9yXCIpXG4gIHJlcXVpcmVGdW5jdGlvbihjbGllbnQuaW5zcGVjdFN5bmNTdGF0ZSwgXCJzeW5jQ2xpZW50Lmluc3BlY3RTeW5jU3RhdGVcIilcbiAgcmVxdWlyZUZ1bmN0aW9uKGNsaWVudC5pc0xpZmVjeWNsZUFib3J0LCBcInN5bmNDbGllbnQuaXNMaWZlY3ljbGVBYm9ydFwiKVxuICByZXF1aXJlRnVuY3Rpb24oY2xpZW50LmlzT25saW5lLCBcInN5bmNDbGllbnQuaXNPbmxpbmVcIilcbiAgcmVxdWlyZUZ1bmN0aW9uKGNsaWVudC5wdWxsLCBcInN5bmNDbGllbnQucHVsbFwiKVxuICByZXF1aXJlRnVuY3Rpb24oY2xpZW50LnJlcGxheVBlbmRpbmcsIFwic3luY0NsaWVudC5yZXBsYXlQZW5kaW5nXCIpXG4gIHJlcXVpcmVGdW5jdGlvbihjbGllbnQucmVzb2x2ZUNvbmZsaWN0LCBcInN5bmNDbGllbnQucmVzb2x2ZUNvbmZsaWN0XCIpXG4gIHJlcXVpcmVGdW5jdGlvbihjbGllbnQuc3RhcnQsIFwic3luY0NsaWVudC5zdGFydFwiKVxuICByZXF1aXJlRnVuY3Rpb24oY2xpZW50LnN0b3AsIFwic3luY0NsaWVudC5zdG9wXCIpXG4gIHJlcXVpcmVGdW5jdGlvbihjbGllbnQuc3Vic2NyaWJlUmVhbHRpbWUsIFwic3luY0NsaWVudC5zdWJzY3JpYmVSZWFsdGltZVwiKVxufVxuIl19