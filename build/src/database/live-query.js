// @ts-check
import debounceFunction from "debounce";
import recordChanges from "./record-changes.js";
import restArgsError from "../utils/rest-args-error.js";
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
class LiveQuery {
    /**
     * Builds a live query controller for a query source.
     * @param {object} args - Options.
     * @param {LiveQuerySource<T>} args.query - Query source providing model class and `toArray`.
     * @param {RecordModelClass[]} [args.models] - Model classes to observe. Defaults to `[query.getModelClass()]`; pass this to also react to joined models.
     * @param {number} [args.debounce] - Trailing debounce in ms for re-runs. Defaults to microtask coalescing.
     */
    constructor({ query, ...restArgs }) {
        const { debounce, models, ...unknownArgs } = restArgs;
        restArgsError(unknownArgs);
        if (!query)
            throw new Error("No query given to LiveQuery");
        /** @type {LiveQuerySource<T>} */
        this._query = query;
        /** @type {RecordModelClass[]} */
        this._modelClasses = models ?? [query.getModelClass()];
        /** @type {LiveQueryState<T>} */
        this._state = { error: null, loading: true, results: [] };
        /**
         * State-change listeners notified after every state transition.
         * @type {Set<() => void>} */
        this._listeners = new Set();
        /**
         * Record-change unsubscribe callbacks registered on `start`.
         * @type {Array<() => void>} */
        this._unsubscribes = [];
        /** @type {number} */
        this._requestId = 0;
        /** @type {boolean} */
        this._closed = false;
        /** @type {boolean} */
        this._started = false;
        /** @type {boolean} */
        this._runScheduled = false;
        /**
         * Promise for the currently in-flight run, or null when idle.
         * @type {Promise<void> | null} */
        this._runningPromise = null;
        /**
         * Schedules a coalesced re-run: a trailing debounce when configured, else microtask coalescing.
         * @type {(() => void) & {clear?: () => void}} */
        this._scheduleRun = typeof debounce === "number"
            ? debounceFunction(() => this._run(), debounce)
            : () => this._scheduleMicrotaskRun();
        /**
         * Record-change listener scheduling a re-run while the controller is open.
         * @type {() => void} */
        this._onRecordChange = () => {
            if (!this._closed)
                this._scheduleRun();
        };
    }
    /**
     * Subscribes to record changes and runs the initial query. Idempotent.
     * @returns {void}
     */
    start() {
        if (this._closed || this._started)
            return;
        this._started = true;
        for (const modelClass of this._modelClasses) {
            const databaseIdentity = this._query.databaseIdentityForModel?.(modelClass);
            this._unsubscribes.push(recordChanges.subscribe(modelClass, this._onRecordChange, { databaseIdentity }));
        }
        this._run();
    }
    /**
     * Returns the current state. The reference only changes when the state changes,
     * so it is safe to use as a React external-store snapshot.
     * @returns {LiveQueryState<T>} Current live-query state.
     */
    getState() {
        return this._state;
    }
    /**
     * Subscribes a listener notified after every state change.
     * @param {() => void} listener - State-change listener.
     * @returns {() => void} Unsubscribe callback.
     */
    subscribe(listener) {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }
    /**
     * Unsubscribes from record changes, drops listeners, and prevents further runs.
     * @returns {void}
     */
    close() {
        if (this._closed)
            return;
        this._closed = true;
        for (const unsubscribe of this._unsubscribes) {
            unsubscribe();
        }
        this._unsubscribes = [];
        this._listeners.clear();
        if (this._scheduleRun.clear)
            this._scheduleRun.clear();
    }
    /**
     * Awaits any scheduled or in-flight run so callers (tests) can observe settled
     * results. Bounded so a continuous change stream cannot loop forever.
     * @returns {Promise<void>}
     */
    async whenSettled() {
        for (let attempt = 0; attempt < 100; attempt++) {
            if (this._closed)
                return;
            if (!this._runScheduled && !this._runningPromise)
                return;
            if (this._runningPromise)
                await this._runningPromise;
            await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
        }
    }
    /**
     * Schedules a microtask-coalesced re-run, collapsing a synchronous burst of
     * change events into a single run.
     * @returns {void}
     */
    _scheduleMicrotaskRun() {
        if (this._runScheduled)
            return;
        this._runScheduled = true;
        queueMicrotask(() => {
            this._runScheduled = false;
            if (!this._closed)
                this._run();
        });
    }
    /**
     * Runs the query and applies its results unless a newer run superseded it or the
     * controller was closed. A run error surfaces in state (with the previous
     * results kept) rather than rejecting a background promise.
     * @returns {Promise<void>}
     */
    _run() {
        const requestId = ++this._requestId;
        const runningPromise = (async () => {
            try {
                const results = await this._query.toArray();
                if (this._closed || requestId !== this._requestId)
                    return;
                this._setState({ error: null, loading: false, results });
            }
            catch (error) {
                if (this._closed || requestId !== this._requestId)
                    return;
                this._setState({ error: /** @type {Error} */ (error), loading: false, results: this._state.results });
            }
        })();
        this._runningPromise = runningPromise;
        void runningPromise.then(() => {
            if (this._runningPromise === runningPromise)
                this._runningPromise = null;
        });
        return runningPromise;
    }
    /**
     * Replaces the state and notifies listeners.
     * @param {LiveQueryState<T>} state - Next state.
     * @returns {void}
     */
    _setState(state) {
        this._state = state;
        for (const listener of Array.from(this._listeners)) {
            listener();
        }
    }
}
export default LiveQuery;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGl2ZS1xdWVyeS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9kYXRhYmFzZS9saXZlLXF1ZXJ5LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLGdCQUFnQixNQUFNLFVBQVUsQ0FBQTtBQUV2QyxPQUFPLGFBQWEsTUFBTSxxQkFBcUIsQ0FBQTtBQUMvQyxPQUFPLGFBQWEsTUFBTSw2QkFBNkIsQ0FBQTtBQUV2RDs7NEVBRTRFO0FBRTVFOzs7Ozs7Ozs7R0FTRztBQUVIOzs7Ozs7O0dBT0c7QUFFSDs7Ozs7Ozs7Ozs7O0dBWUc7QUFDSCxNQUFNLFNBQVM7SUFDYjs7Ozs7O09BTUc7SUFDSCxZQUFZLEVBQUMsS0FBSyxFQUFFLEdBQUcsUUFBUSxFQUFDO1FBQzlCLE1BQU0sRUFBQyxRQUFRLEVBQUUsTUFBTSxFQUFFLEdBQUcsV0FBVyxFQUFDLEdBQUcsUUFBUSxDQUFBO1FBRW5ELGFBQWEsQ0FBQyxXQUFXLENBQUMsQ0FBQTtRQUUxQixJQUFJLENBQUMsS0FBSztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsNkJBQTZCLENBQUMsQ0FBQTtRQUUxRCxpQ0FBaUM7UUFDakMsSUFBSSxDQUFDLE1BQU0sR0FBRyxLQUFLLENBQUE7UUFFbkIsaUNBQWlDO1FBQ2pDLElBQUksQ0FBQyxhQUFhLEdBQUcsTUFBTSxJQUFJLENBQUMsS0FBSyxDQUFDLGFBQWEsRUFBRSxDQUFDLENBQUE7UUFFdEQsZ0NBQWdDO1FBQ2hDLElBQUksQ0FBQyxNQUFNLEdBQUcsRUFBQyxLQUFLLEVBQUUsSUFBSSxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsT0FBTyxFQUFFLEVBQUUsRUFBQyxDQUFBO1FBRXZEOztxQ0FFNkI7UUFDN0IsSUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1FBRTNCOzt1Q0FFK0I7UUFDL0IsSUFBSSxDQUFDLGFBQWEsR0FBRyxFQUFFLENBQUE7UUFFdkIscUJBQXFCO1FB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LG9CQUFvQixDQUFDLENBQUMsS0FBSyxDQUFDLEVBQUUsT0FBTyxFQUFFLEtBQUssRUFBRSxPQUFPLEVBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxPQUFPLEVBQUMsQ0FBQyxDQUFBO1lBQ3JHLENBQUM7UUFDSCxDQUFDLENBQUMsRUFBRSxDQUFBO1FBRUosSUFBSSxDQUFDLGVBQWUsR0FBRyxjQUFjLENBQUE7UUFDckMsS0FBSyxjQUFjLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRTtZQUM1QixJQUFJLElBQUksQ0FBQyxlQUFlLEtBQUssY0FBYztnQkFBRSxJQUFJLENBQUMsZUFBZSxHQUFHLElBQUksQ0FBQTtRQUMxRSxDQUFDLENBQUMsQ0FBQTtRQUVGLE9BQU8sY0FBYyxDQUFBO0lBQ3ZCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsU0FBUyxDQUFDLEtBQUs7UUFDYixJQUFJLENBQUMsTUFBTSxHQUFHLEtBQUssQ0FBQTtRQUVuQixLQUFLLE1BQU0sUUFBUSxJQUFJLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUM7WUFDbkQsUUFBUSxFQUFFLENBQUE7UUFDWixDQUFDO0lBQ0gsQ0FBQztDQUNGO0FBRUQsZUFBZSxTQUFTLENBQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IGRlYm91bmNlRnVuY3Rpb24gZnJvbSBcImRlYm91bmNlXCJcblxuaW1wb3J0IHJlY29yZENoYW5nZXMgZnJvbSBcIi4vcmVjb3JkLWNoYW5nZXMuanNcIlxuaW1wb3J0IHJlc3RBcmdzRXJyb3IgZnJvbSBcIi4uL3V0aWxzL3Jlc3QtYXJncy1lcnJvci5qc1wiXG5cbi8qKlxuICogUmVjb3JkTW9kZWxDbGFzcyB0eXBlLlxuICogQHR5cGVkZWYge3R5cGVvZiBpbXBvcnQoXCIuL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBSZWNvcmRNb2RlbENsYXNzICovXG5cbi8qKlxuICogVGhlIG1pbmltYWwgcXVlcnkgY29udHJhY3QgYSBsaXZlIHF1ZXJ5IG5lZWRzOiBhIHJvb3QgbW9kZWwgY2xhc3MgdG8gb2JzZXJ2ZVxuICogZm9yIGNvbW1pdHRlZCBjaGFuZ2VzIGFuZCBhIHdheSB0byBydW4gdGhlIHF1ZXJ5IGFuZCByZXR1cm4gdGhlIGN1cnJlbnQgcm93cy5cbiAqIGBNb2RlbC53aGVyZSh7Li4ufSlgIChhIG1vZGVsLWNsYXNzIHF1ZXJ5KSBzYXRpc2ZpZXMgdGhpcyBkaXJlY3RseS5cbiAqIEB0ZW1wbGF0ZSBUXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBMaXZlUXVlcnlTb3VyY2VcbiAqIEBwcm9wZXJ0eSB7KCkgPT4gUmVjb3JkTW9kZWxDbGFzc30gZ2V0TW9kZWxDbGFzcyAtIFJvb3QgbW9kZWwgY2xhc3MgdGhlIHF1ZXJ5IHJlYWRzLlxuICogQHByb3BlcnR5IHsobW9kZWxDbGFzczogUmVjb3JkTW9kZWxDbGFzcykgPT4gc3RyaW5nfSBbZGF0YWJhc2VJZGVudGl0eUZvck1vZGVsXSAtIENhcHR1cmVkIHBoeXNpY2FsIGlkZW50aXR5IGZvciBhbiBvYnNlcnZlZCBtb2RlbC5cbiAqIEBwcm9wZXJ0eSB7KCkgPT4gUHJvbWlzZTxUW10+fSB0b0FycmF5IC0gUnVucyB0aGUgcXVlcnkgYW5kIHJlc29sdmVzIHRoZSBjdXJyZW50IHJvd3MuXG4gKi9cblxuLyoqXG4gKiBMaXZlUXVlcnlTdGF0ZSB0eXBlLlxuICogQHRlbXBsYXRlIFRcbiAqIEB0eXBlZGVmIHtvYmplY3R9IExpdmVRdWVyeVN0YXRlXG4gKiBAcHJvcGVydHkge1RbXX0gcmVzdWx0cyAtIEN1cnJlbnQgcXVlcnkgcmVzdWx0cy5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gbG9hZGluZyAtIFdoZXRoZXIgdGhlIGluaXRpYWwgcmVzdWx0cyBhcmUgc3RpbGwgbG9hZGluZy5cbiAqIEBwcm9wZXJ0eSB7RXJyb3IgfCBudWxsfSBlcnJvciAtIFRoZSBsYXN0IHJ1biBlcnJvciwgb3IgbnVsbCB3aGVuIHRoZSBsYXN0IHJ1biBzdWNjZWVkZWQuXG4gKi9cblxuLyoqXG4gKiBBIHJlYWN0aXZlIHF1ZXJ5IGNvbnRyb2xsZXI6IGZldGNoZXMgb25jZSwgc3Vic2NyaWJlcyB0byBjb21taXR0ZWQgY2hhbmdlcyBvZlxuICogaXRzIG1vZGVsIGNsYXNzKGVzKSwgYW5kIHJlLXJ1bnMgd2hlbmV2ZXIgYSB3YXRjaGVkIG1vZGVsIGNoYW5nZXMuIFJlLXJ1bnMgYXJlXG4gKiBjb2FsZXNjZWQgKG1pY3JvdGFzayBieSBkZWZhdWx0LCBvciBhIHRyYWlsaW5nIGRlYm91bmNlKSBhbmQgcHJvdGVjdGVkIGFnYWluc3RcbiAqIHN0YWxlIHJlc3BvbnNlcyBieSBhIG1vbm90b25pY2FsbHkgaW5jcmVhc2luZyByZXF1ZXN0IGlkLCBzbyBhbiBpbi1mbGlnaHQgcnVuXG4gKiBzdXBlcnNlZGVkIGJ5IGEgbmV3ZXIgY2hhbmdlIG5ldmVyIG92ZXJ3cml0ZXMgZnJlc2hlciByZXN1bHRzLiBGcmFtZXdvcmstbGV2ZWxcbiAqIGFuZCBSZWFjdC1mcmVlIHNvIGl0IGNhbiBiZSB1bml0IHRlc3RlZCBhbmQgd3JhcHBlZCBieSBgdXNlTGl2ZVF1ZXJ5YC5cbiAqXG4gKiBDb3N0IG1vZGVsOiBpbnZhbGlkYXRpb24gaXMgYnkgbW9kZWwgY2xhc3MuIEEgY2hhbmdlIHRvIG1vZGVsIE0gc2NoZWR1bGVzIG9uZVxuICogcmUtcnVuIG9mIGV2ZXJ5IGxpdmUgcXVlcnkgb2JzZXJ2aW5nIE0gKG5vIHBlci1jb25kaXRpb24gbWF0Y2hpbmcpOyBhIGJhdGNoIG9mXG4gKiBjaGFuZ2VzIGNvYWxlc2NlcyBpbnRvIGEgc2luZ2xlIHJlLXJ1bi5cbiAqIEB0ZW1wbGF0ZSBUXG4gKi9cbmNsYXNzIExpdmVRdWVyeSB7XG4gIC8qKlxuICAgKiBCdWlsZHMgYSBsaXZlIHF1ZXJ5IGNvbnRyb2xsZXIgZm9yIGEgcXVlcnkgc291cmNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7TGl2ZVF1ZXJ5U291cmNlPFQ+fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgc291cmNlIHByb3ZpZGluZyBtb2RlbCBjbGFzcyBhbmQgYHRvQXJyYXlgLlxuICAgKiBAcGFyYW0ge1JlY29yZE1vZGVsQ2xhc3NbXX0gW2FyZ3MubW9kZWxzXSAtIE1vZGVsIGNsYXNzZXMgdG8gb2JzZXJ2ZS4gRGVmYXVsdHMgdG8gYFtxdWVyeS5nZXRNb2RlbENsYXNzKCldYDsgcGFzcyB0aGlzIHRvIGFsc28gcmVhY3QgdG8gam9pbmVkIG1vZGVscy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmRlYm91bmNlXSAtIFRyYWlsaW5nIGRlYm91bmNlIGluIG1zIGZvciByZS1ydW5zLiBEZWZhdWx0cyB0byBtaWNyb3Rhc2sgY29hbGVzY2luZy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtxdWVyeSwgLi4ucmVzdEFyZ3N9KSB7XG4gICAgY29uc3Qge2RlYm91bmNlLCBtb2RlbHMsIC4uLnVua25vd25BcmdzfSA9IHJlc3RBcmdzXG5cbiAgICByZXN0QXJnc0Vycm9yKHVua25vd25BcmdzKVxuXG4gICAgaWYgKCFxdWVyeSkgdGhyb3cgbmV3IEVycm9yKFwiTm8gcXVlcnkgZ2l2ZW4gdG8gTGl2ZVF1ZXJ5XCIpXG5cbiAgICAvKiogQHR5cGUge0xpdmVRdWVyeVNvdXJjZTxUPn0gKi9cbiAgICB0aGlzLl9xdWVyeSA9IHF1ZXJ5XG5cbiAgICAvKiogQHR5cGUge1JlY29yZE1vZGVsQ2xhc3NbXX0gKi9cbiAgICB0aGlzLl9tb2RlbENsYXNzZXMgPSBtb2RlbHMgPz8gW3F1ZXJ5LmdldE1vZGVsQ2xhc3MoKV1cblxuICAgIC8qKiBAdHlwZSB7TGl2ZVF1ZXJ5U3RhdGU8VD59ICovXG4gICAgdGhpcy5fc3RhdGUgPSB7ZXJyb3I6IG51bGwsIGxvYWRpbmc6IHRydWUsIHJlc3VsdHM6IFtdfVxuXG4gICAgLyoqXG4gICAgICogU3RhdGUtY2hhbmdlIGxpc3RlbmVycyBub3RpZmllZCBhZnRlciBldmVyeSBzdGF0ZSB0cmFuc2l0aW9uLlxuICAgICAqIEB0eXBlIHtTZXQ8KCkgPT4gdm9pZD59ICovXG4gICAgdGhpcy5fbGlzdGVuZXJzID0gbmV3IFNldCgpXG5cbiAgICAvKipcbiAgICAgKiBSZWNvcmQtY2hhbmdlIHVuc3Vic2NyaWJlIGNhbGxiYWNrcyByZWdpc3RlcmVkIG9uIGBzdGFydGAuXG4gICAgICogQHR5cGUge0FycmF5PCgpID0+IHZvaWQ+fSAqL1xuICAgIHRoaXMuX3Vuc3Vic2NyaWJlcyA9IFtdXG5cbiAgICAvKiogQHR5cGUge251bWJlcn0gKi9cbiAgICB0aGlzLl9yZXF1ZXN0SWQgPSAwXG5cbiAgICAvKiogQHR5cGUge2Jvb2xlYW59ICovXG4gICAgdGhpcy5fY2xvc2VkID0gZmFsc2VcblxuICAgIC8qKiBAdHlwZSB7Ym9vbGVhbn0gKi9cbiAgICB0aGlzLl9zdGFydGVkID0gZmFsc2VcblxuICAgIC8qKiBAdHlwZSB7Ym9vbGVhbn0gKi9cbiAgICB0aGlzLl9ydW5TY2hlZHVsZWQgPSBmYWxzZVxuXG4gICAgLyoqXG4gICAgICogUHJvbWlzZSBmb3IgdGhlIGN1cnJlbnRseSBpbi1mbGlnaHQgcnVuLCBvciBudWxsIHdoZW4gaWRsZS5cbiAgICAgKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IG51bGx9ICovXG4gICAgdGhpcy5fcnVubmluZ1Byb21pc2UgPSBudWxsXG5cbiAgICAvKipcbiAgICAgKiBTY2hlZHVsZXMgYSBjb2FsZXNjZWQgcmUtcnVuOiBhIHRyYWlsaW5nIGRlYm91bmNlIHdoZW4gY29uZmlndXJlZCwgZWxzZSBtaWNyb3Rhc2sgY29hbGVzY2luZy5cbiAgICAgKiBAdHlwZSB7KCgpID0+IHZvaWQpICYge2NsZWFyPzogKCkgPT4gdm9pZH19ICovXG4gICAgdGhpcy5fc2NoZWR1bGVSdW4gPSB0eXBlb2YgZGVib3VuY2UgPT09IFwibnVtYmVyXCJcbiAgICAgID8gZGVib3VuY2VGdW5jdGlvbigoKSA9PiB0aGlzLl9ydW4oKSwgZGVib3VuY2UpXG4gICAgICA6ICgpID0+IHRoaXMuX3NjaGVkdWxlTWljcm90YXNrUnVuKClcblxuICAgIC8qKlxuICAgICAqIFJlY29yZC1jaGFuZ2UgbGlzdGVuZXIgc2NoZWR1bGluZyBhIHJlLXJ1biB3aGlsZSB0aGUgY29udHJvbGxlciBpcyBvcGVuLlxuICAgICAqIEB0eXBlIHsoKSA9PiB2b2lkfSAqL1xuICAgIHRoaXMuX29uUmVjb3JkQ2hhbmdlID0gKCkgPT4ge1xuICAgICAgaWYgKCF0aGlzLl9jbG9zZWQpIHRoaXMuX3NjaGVkdWxlUnVuKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU3Vic2NyaWJlcyB0byByZWNvcmQgY2hhbmdlcyBhbmQgcnVucyB0aGUgaW5pdGlhbCBxdWVyeS4gSWRlbXBvdGVudC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGFydCgpIHtcbiAgICBpZiAodGhpcy5fY2xvc2VkIHx8IHRoaXMuX3N0YXJ0ZWQpIHJldHVyblxuXG4gICAgdGhpcy5fc3RhcnRlZCA9IHRydWVcblxuICAgIGZvciAoY29uc3QgbW9kZWxDbGFzcyBvZiB0aGlzLl9tb2RlbENsYXNzZXMpIHtcbiAgICAgIGNvbnN0IGRhdGFiYXNlSWRlbnRpdHkgPSB0aGlzLl9xdWVyeS5kYXRhYmFzZUlkZW50aXR5Rm9yTW9kZWw/Lihtb2RlbENsYXNzKVxuXG4gICAgICB0aGlzLl91bnN1YnNjcmliZXMucHVzaChyZWNvcmRDaGFuZ2VzLnN1YnNjcmliZShtb2RlbENsYXNzLCB0aGlzLl9vblJlY29yZENoYW5nZSwge2RhdGFiYXNlSWRlbnRpdHl9KSlcbiAgICB9XG5cbiAgICB0aGlzLl9ydW4oKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGN1cnJlbnQgc3RhdGUuIFRoZSByZWZlcmVuY2Ugb25seSBjaGFuZ2VzIHdoZW4gdGhlIHN0YXRlIGNoYW5nZXMsXG4gICAqIHNvIGl0IGlzIHNhZmUgdG8gdXNlIGFzIGEgUmVhY3QgZXh0ZXJuYWwtc3RvcmUgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtMaXZlUXVlcnlTdGF0ZTxUPn0gQ3VycmVudCBsaXZlLXF1ZXJ5IHN0YXRlLlxuICAgKi9cbiAgZ2V0U3RhdGUoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3N0YXRlXG4gIH1cblxuICAvKipcbiAgICogU3Vic2NyaWJlcyBhIGxpc3RlbmVyIG5vdGlmaWVkIGFmdGVyIGV2ZXJ5IHN0YXRlIGNoYW5nZS5cbiAgICogQHBhcmFtIHsoKSA9PiB2b2lkfSBsaXN0ZW5lciAtIFN0YXRlLWNoYW5nZSBsaXN0ZW5lci5cbiAgICogQHJldHVybnMgeygpID0+IHZvaWR9IFVuc3Vic2NyaWJlIGNhbGxiYWNrLlxuICAgKi9cbiAgc3Vic2NyaWJlKGxpc3RlbmVyKSB7XG4gICAgdGhpcy5fbGlzdGVuZXJzLmFkZChsaXN0ZW5lcilcblxuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICB0aGlzLl9saXN0ZW5lcnMuZGVsZXRlKGxpc3RlbmVyKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBVbnN1YnNjcmliZXMgZnJvbSByZWNvcmQgY2hhbmdlcywgZHJvcHMgbGlzdGVuZXJzLCBhbmQgcHJldmVudHMgZnVydGhlciBydW5zLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGNsb3NlKCkge1xuICAgIGlmICh0aGlzLl9jbG9zZWQpIHJldHVyblxuXG4gICAgdGhpcy5fY2xvc2VkID0gdHJ1ZVxuXG4gICAgZm9yIChjb25zdCB1bnN1YnNjcmliZSBvZiB0aGlzLl91bnN1YnNjcmliZXMpIHtcbiAgICAgIHVuc3Vic2NyaWJlKClcbiAgICB9XG5cbiAgICB0aGlzLl91bnN1YnNjcmliZXMgPSBbXVxuICAgIHRoaXMuX2xpc3RlbmVycy5jbGVhcigpXG5cbiAgICBpZiAodGhpcy5fc2NoZWR1bGVSdW4uY2xlYXIpIHRoaXMuX3NjaGVkdWxlUnVuLmNsZWFyKClcbiAgfVxuXG4gIC8qKlxuICAgKiBBd2FpdHMgYW55IHNjaGVkdWxlZCBvciBpbi1mbGlnaHQgcnVuIHNvIGNhbGxlcnMgKHRlc3RzKSBjYW4gb2JzZXJ2ZSBzZXR0bGVkXG4gICAqIHJlc3VsdHMuIEJvdW5kZWQgc28gYSBjb250aW51b3VzIGNoYW5nZSBzdHJlYW0gY2Fubm90IGxvb3AgZm9yZXZlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyB3aGVuU2V0dGxlZCgpIHtcbiAgICBmb3IgKGxldCBhdHRlbXB0ID0gMDsgYXR0ZW1wdCA8IDEwMDsgYXR0ZW1wdCsrKSB7XG4gICAgICBpZiAodGhpcy5fY2xvc2VkKSByZXR1cm5cbiAgICAgIGlmICghdGhpcy5fcnVuU2NoZWR1bGVkICYmICF0aGlzLl9ydW5uaW5nUHJvbWlzZSkgcmV0dXJuXG5cbiAgICAgIGlmICh0aGlzLl9ydW5uaW5nUHJvbWlzZSkgYXdhaXQgdGhpcy5fcnVubmluZ1Byb21pc2VcblxuICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHF1ZXVlTWljcm90YXNrKCgpID0+IHJlc29sdmUodW5kZWZpbmVkKSkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFNjaGVkdWxlcyBhIG1pY3JvdGFzay1jb2FsZXNjZWQgcmUtcnVuLCBjb2xsYXBzaW5nIGEgc3luY2hyb25vdXMgYnVyc3Qgb2ZcbiAgICogY2hhbmdlIGV2ZW50cyBpbnRvIGEgc2luZ2xlIHJ1bi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2NoZWR1bGVNaWNyb3Rhc2tSdW4oKSB7XG4gICAgaWYgKHRoaXMuX3J1blNjaGVkdWxlZCkgcmV0dXJuXG5cbiAgICB0aGlzLl9ydW5TY2hlZHVsZWQgPSB0cnVlXG5cbiAgICBxdWV1ZU1pY3JvdGFzaygoKSA9PiB7XG4gICAgICB0aGlzLl9ydW5TY2hlZHVsZWQgPSBmYWxzZVxuXG4gICAgICBpZiAoIXRoaXMuX2Nsb3NlZCkgdGhpcy5fcnVuKClcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdGhlIHF1ZXJ5IGFuZCBhcHBsaWVzIGl0cyByZXN1bHRzIHVubGVzcyBhIG5ld2VyIHJ1biBzdXBlcnNlZGVkIGl0IG9yIHRoZVxuICAgKiBjb250cm9sbGVyIHdhcyBjbG9zZWQuIEEgcnVuIGVycm9yIHN1cmZhY2VzIGluIHN0YXRlICh3aXRoIHRoZSBwcmV2aW91c1xuICAgKiByZXN1bHRzIGtlcHQpIHJhdGhlciB0aGFuIHJlamVjdGluZyBhIGJhY2tncm91bmQgcHJvbWlzZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBfcnVuKCkge1xuICAgIGNvbnN0IHJlcXVlc3RJZCA9ICsrdGhpcy5fcmVxdWVzdElkXG4gICAgY29uc3QgcnVubmluZ1Byb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IHRoaXMuX3F1ZXJ5LnRvQXJyYXkoKVxuXG4gICAgICAgIGlmICh0aGlzLl9jbG9zZWQgfHwgcmVxdWVzdElkICE9PSB0aGlzLl9yZXF1ZXN0SWQpIHJldHVyblxuXG4gICAgICAgIHRoaXMuX3NldFN0YXRlKHtlcnJvcjogbnVsbCwgbG9hZGluZzogZmFsc2UsIHJlc3VsdHN9KVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKHRoaXMuX2Nsb3NlZCB8fCByZXF1ZXN0SWQgIT09IHRoaXMuX3JlcXVlc3RJZCkgcmV0dXJuXG5cbiAgICAgICAgdGhpcy5fc2V0U3RhdGUoe2Vycm9yOiAvKiogQHR5cGUge0Vycm9yfSAqLyAoZXJyb3IpLCBsb2FkaW5nOiBmYWxzZSwgcmVzdWx0czogdGhpcy5fc3RhdGUucmVzdWx0c30pXG4gICAgICB9XG4gICAgfSkoKVxuXG4gICAgdGhpcy5fcnVubmluZ1Byb21pc2UgPSBydW5uaW5nUHJvbWlzZVxuICAgIHZvaWQgcnVubmluZ1Byb21pc2UudGhlbigoKSA9PiB7XG4gICAgICBpZiAodGhpcy5fcnVubmluZ1Byb21pc2UgPT09IHJ1bm5pbmdQcm9taXNlKSB0aGlzLl9ydW5uaW5nUHJvbWlzZSA9IG51bGxcbiAgICB9KVxuXG4gICAgcmV0dXJuIHJ1bm5pbmdQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogUmVwbGFjZXMgdGhlIHN0YXRlIGFuZCBub3RpZmllcyBsaXN0ZW5lcnMuXG4gICAqIEBwYXJhbSB7TGl2ZVF1ZXJ5U3RhdGU8VD59IHN0YXRlIC0gTmV4dCBzdGF0ZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2V0U3RhdGUoc3RhdGUpIHtcbiAgICB0aGlzLl9zdGF0ZSA9IHN0YXRlXG5cbiAgICBmb3IgKGNvbnN0IGxpc3RlbmVyIG9mIEFycmF5LmZyb20odGhpcy5fbGlzdGVuZXJzKSkge1xuICAgICAgbGlzdGVuZXIoKVxuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBMaXZlUXVlcnlcbiJdfQ==