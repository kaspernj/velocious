// @ts-check

import debounceFunction from "debounce"

import recordChanges from "./record-changes.js"
import restArgsError from "../utils/rest-args-error.js"

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
  constructor({query, ...restArgs}) {
    const {debounce, models, ...unknownArgs} = restArgs

    restArgsError(unknownArgs)

    if (!query) throw new Error("No query given to LiveQuery")

    /** @type {LiveQuerySource<T>} */
    this._query = query

    /** @type {RecordModelClass[]} */
    this._modelClasses = models ?? [query.getModelClass()]

    /** @type {LiveQueryState<T>} */
    this._state = {error: null, loading: true, results: []}

    /**
     * State-change listeners notified after every state transition.
     * @type {Set<() => void>} */
    this._listeners = new Set()

    /**
     * Record-change unsubscribe callbacks registered on `start`.
     * @type {Array<() => void>} */
    this._unsubscribes = []

    /** @type {number} */
    this._requestId = 0

    /** @type {boolean} */
    this._closed = false

    /** @type {boolean} */
    this._started = false

    /** @type {boolean} */
    this._runScheduled = false

    /**
     * Promise for the currently in-flight run, or null when idle.
     * @type {Promise<void> | null} */
    this._runningPromise = null

    /**
     * Schedules a coalesced re-run: a trailing debounce when configured, else microtask coalescing.
     * @type {(() => void) & {clear?: () => void}} */
    this._scheduleRun = typeof debounce === "number"
      ? debounceFunction(() => this._run(), debounce)
      : () => this._scheduleMicrotaskRun()

    /**
     * Record-change listener scheduling a re-run while the controller is open.
     * @type {() => void} */
    this._onRecordChange = () => {
      if (!this._closed) this._scheduleRun()
    }
  }

  /**
   * Subscribes to record changes and runs the initial query. Idempotent.
   * @returns {void}
   */
  start() {
    if (this._closed || this._started) return

    this._started = true

    for (const modelClass of this._modelClasses) {
      this._unsubscribes.push(recordChanges.subscribe(modelClass, this._onRecordChange))
    }

    this._run()
  }

  /**
   * Returns the current state. The reference only changes when the state changes,
   * so it is safe to use as a React external-store snapshot.
   * @returns {LiveQueryState<T>} Current live-query state.
   */
  getState() {
    return this._state
  }

  /**
   * Subscribes a listener notified after every state change.
   * @param {() => void} listener - State-change listener.
   * @returns {() => void} Unsubscribe callback.
   */
  subscribe(listener) {
    this._listeners.add(listener)

    return () => {
      this._listeners.delete(listener)
    }
  }

  /**
   * Unsubscribes from record changes, drops listeners, and prevents further runs.
   * @returns {void}
   */
  close() {
    if (this._closed) return

    this._closed = true

    for (const unsubscribe of this._unsubscribes) {
      unsubscribe()
    }

    this._unsubscribes = []
    this._listeners.clear()

    if (this._scheduleRun.clear) this._scheduleRun.clear()
  }

  /**
   * Awaits any scheduled or in-flight run so callers (tests) can observe settled
   * results. Bounded so a continuous change stream cannot loop forever.
   * @returns {Promise<void>}
   */
  async whenSettled() {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (this._closed) return
      if (!this._runScheduled && !this._runningPromise) return

      if (this._runningPromise) await this._runningPromise

      await new Promise((resolve) => queueMicrotask(() => resolve(undefined)))
    }
  }

  /**
   * Schedules a microtask-coalesced re-run, collapsing a synchronous burst of
   * change events into a single run.
   * @returns {void}
   */
  _scheduleMicrotaskRun() {
    if (this._runScheduled) return

    this._runScheduled = true

    queueMicrotask(() => {
      this._runScheduled = false

      if (!this._closed) this._run()
    })
  }

  /**
   * Runs the query and applies its results unless a newer run superseded it or the
   * controller was closed. A run error surfaces in state (with the previous
   * results kept) rather than rejecting a background promise.
   * @returns {Promise<void>}
   */
  _run() {
    const requestId = ++this._requestId
    const runningPromise = (async () => {
      try {
        const results = await this._query.toArray()

        if (this._closed || requestId !== this._requestId) return

        this._setState({error: null, loading: false, results})
      } catch (error) {
        if (this._closed || requestId !== this._requestId) return

        this._setState({error: /** @type {Error} */ (error), loading: false, results: this._state.results})
      }
    })()

    this._runningPromise = runningPromise
    void runningPromise.then(() => {
      if (this._runningPromise === runningPromise) this._runningPromise = null
    })

    return runningPromise
  }

  /**
   * Replaces the state and notifies listeners.
   * @param {LiveQueryState<T>} state - Next state.
   * @returns {void}
   */
  _setState(state) {
    this._state = state

    for (const listener of Array.from(this._listeners)) {
      listener()
    }
  }
}

export default LiveQuery
