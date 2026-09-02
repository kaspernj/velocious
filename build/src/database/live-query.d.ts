export type RecordModelClass = typeof import("./record/index.js").default;
export type LiveQuerySource<T> = {
    /**
     * - Root model class the query reads.
     */
    getModelClass: () => RecordModelClass;
    /**
     * - Captured physical identity for an observed model.
     */
    databaseIdentityForModel?: (modelClass: RecordModelClass) => string;
    /**
     * - Runs the query and resolves the current rows.
     */
    toArray: () => Promise<T[]>;
};
export type LiveQueryState<T> = {
    /**
     * - Current query results.
     */
    results: T[];
    /**
     * - Whether the initial results are still loading.
     */
    loading: boolean;
    /**
     * - The last run error, or null when the last run succeeded.
     */
    error: Error | null;
};
/**
 * RecordModelClass type.
 * @typedef {typeof import("./record/index.js").default} RecordModelClass */
/**
 * The minimal query contract a live query needs: a root model class to observe
 * for committed changes and a way to run the query and return the current rows.
 * `Model.where({...})` (a model-class query) satisfies this directly.
 * @template T
 * @typedef {object} LiveQuerySource
 * @property {() => RecordModelClass} getModelClass - Root model class the query reads.
 * @property {(modelClass: RecordModelClass) => string} [databaseIdentityForModel] - Captured physical identity for an observed model.
 * @property {() => Promise<T[]>} toArray - Runs the query and resolves the current rows.
 */
/**
 * LiveQueryState type.
 * @template T
 * @typedef {object} LiveQueryState
 * @property {T[]} results - Current query results.
 * @property {boolean} loading - Whether the initial results are still loading.
 * @property {Error | null} error - The last run error, or null when the last run succeeded.
 */
/**
 * A reactive query controller: fetches once, subscribes to committed changes of
 * its model class(es), and re-runs whenever a watched model changes. Re-runs are
 * coalesced (microtask by default, or a trailing debounce) and protected against
 * stale responses by a monotonically increasing request id, so an in-flight run
 * superseded by a newer change never overwrites fresher results. Framework-level
 * and React-free so it can be unit tested and wrapped by `useLiveQuery`.
 *
 * Cost model: invalidation is by model class. A change to model M schedules one
 * re-run of every live query observing M (no per-condition matching); a batch of
 * changes coalesces into a single re-run.
 * @template T
 */
declare class LiveQuery<T> {
    /** @type {LiveQuerySource<T>} */
    _query: LiveQuerySource<T>;
    /** @type {RecordModelClass[]} */
    _modelClasses: RecordModelClass[];
    /** @type {LiveQueryState<T>} */
    _state: LiveQueryState<T>;
    /**
     * State-change listeners notified after every state transition.
     * @type {Set<() => void>} */
    _listeners: Set<() => void>;
    /**
     * Record-change unsubscribe callbacks registered on `start`.
     * @type {Array<() => void>} */
    _unsubscribes: Array<() => void>;
    /** @type {number} */
    _requestId: number;
    /** @type {boolean} */
    _closed: boolean;
    /** @type {boolean} */
    _started: boolean;
    /** @type {boolean} */
    _runScheduled: boolean;
    /**
     * Promise for the currently in-flight run, or null when idle.
     * @type {Promise<void> | null} */
    _runningPromise: Promise<void> | null;
    /**
     * Schedules a coalesced re-run: a trailing debounce when configured, else microtask coalescing.
     * @type {(() => void) & {clear?: () => void}} */
    _scheduleRun: (() => void) & {
        clear?: () => void;
    };
    /**
     * Record-change listener scheduling a re-run while the controller is open.
     * @type {() => void} */
    _onRecordChange: () => void;
    /**
     * Builds a live query controller for a query source.
     * @param {object} args - Options.
     * @param {LiveQuerySource<T>} args.query - Query source providing model class and `toArray`.
     * @param {RecordModelClass[]} [args.models] - Model classes to observe. Defaults to `[query.getModelClass()]`; pass this to also react to joined models.
     * @param {number} [args.debounce] - Trailing debounce in ms for re-runs. Defaults to microtask coalescing.
     */
    constructor({ query, ...restArgs }: {
        query: LiveQuerySource<T>;
        models?: RecordModelClass[];
        debounce?: number;
    });
    /**
     * Subscribes to record changes and runs the initial query. Idempotent.
     * @returns {void}
     */
    start(): void;
    /**
     * Returns the current state. The reference only changes when the state changes,
     * so it is safe to use as a React external-store snapshot.
     * @returns {LiveQueryState<T>} Current live-query state.
     */
    getState(): LiveQueryState<T>;
    /**
     * Subscribes a listener notified after every state change.
     * @param {() => void} listener - State-change listener.
     * @returns {() => void} Unsubscribe callback.
     */
    subscribe(listener: () => void): () => void;
    /**
     * Unsubscribes from record changes, drops listeners, and prevents further runs.
     * @returns {void}
     */
    close(): void;
    /**
     * Awaits any scheduled or in-flight run so callers (tests) can observe settled
     * results. Bounded so a continuous change stream cannot loop forever.
     * @returns {Promise<void>}
     */
    whenSettled(): Promise<void>;
    /**
     * Schedules a microtask-coalesced re-run, collapsing a synchronous burst of
     * change events into a single run.
     * @returns {void}
     */
    _scheduleMicrotaskRun(): void;
    /**
     * Runs the query and applies its results unless a newer run superseded it or the
     * controller was closed. A run error surfaces in state (with the previous
     * results kept) rather than rejecting a background promise.
     * @returns {Promise<void>}
     */
    _run(): Promise<void>;
    /**
     * Replaces the state and notifies listeners.
     * @param {LiveQueryState<T>} state - Next state.
     * @returns {void}
     */
    _setState(state: LiveQueryState<T>): void;
}
export default LiveQuery;
//# sourceMappingURL=live-query.d.ts.map