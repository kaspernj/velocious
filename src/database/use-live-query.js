// @ts-check

import {useCallback, useEffect, useMemo, useRef, useSyncExternalStore} from "react"

import LiveQuery from "./live-query.js"

/**
 * RecordModelClass type.
 * @typedef {typeof import("./record/index.js").default} RecordModelClass */

/**
 * LiveQuerySource type.
 * @template T
 * @typedef {import("./live-query.js").LiveQuerySource<T>} LiveQuerySource */

/**
 * LiveQueryState type.
 * @template T
 * @typedef {import("./live-query.js").LiveQueryState<T>} LiveQueryState */

/**
 * UseLiveQueryOptions type.
 * @typedef {object} UseLiveQueryOptions
 * @property {boolean} [active] - Whether the query is active. Default true; pass false to pause and return the empty state.
 * @property {number} [debounce] - Trailing debounce in ms for re-runs. Defaults to microtask coalescing.
 * @property {RecordModelClass[]} [models] - Model classes to observe. Defaults to the query's model class; pass this to also react to joined models.
 */

/**
 * Stable empty state returned while there is no active query, so a paused hook
 * keeps a referentially stable snapshot for `useSyncExternalStore`.
 * @type {LiveQueryState<?>} */
const EMPTY_STATE = {error: null, loading: false, results: []}

/**
 * Assigns and stores a stable identity key for query sources without a `toSql`.
 * @type {WeakMap<object, string>} */
const queryIdentityKeys = new WeakMap()

/**
 * Monotonic counter backing the queryIdentityKeys registry.
 * @type {number} */
let nextQueryIdentity = 0

/**
 * Builds a dependency key identifying a query's semantics so the underlying
 * controller is rebuilt when they change. Model-class queries expose `toSql`, so
 * distinct conditions yield distinct keys; other sources fall back to a stable
 * per-object identity (such sources must be memoized by the caller).
 * @param {LiveQuerySource<?> & {toSql?: () => ?}} query - Query source.
 * @param {RecordModelClass[] | undefined} models - Explicit model classes to observe.
 * @returns {string} Dependency key.
 */
function liveQueryDependencyKey(query, models) {
  const modelNames = (models ?? [query.getModelClass()]).map((modelClass) => modelClass.getModelName()).join(",")

  if (typeof query.toSql === "function") return `${modelNames}::${String(query.toSql())}`

  let identityKey = queryIdentityKeys.get(query)

  if (identityKey === undefined) {
    identityKey = `#${++nextQueryIdentity}`
    queryIdentityKeys.set(query, identityKey)
  }

  return `${modelNames}::${identityKey}`
}

/**
 * React hook declaring what a screen shows and keeping it current from committed
 * local model changes. Runs `query.toArray()` once, subscribes to the query's
 * model class(es) on the record-change bus, and re-runs (coalesced, stale-safe)
 * whenever a watched model commits — so local writes, pull applies, and realtime
 * applies all refresh the results without any manual refresh plumbing.
 * @template T
 * @param {(LiveQuerySource<T> & {toSql?: () => ?}) | null | undefined} query - Query source, e.g. `Model.where({...})`.
 * @param {UseLiveQueryOptions} [options] - Hook options.
 * @returns {LiveQueryState<T>} Current results, loading, and last error.
 */
export default function useLiveQuery(query, options = {}) {
  const {active = true, debounce, models} = options
  const enabled = active && Boolean(query)
  const dependencyKey = enabled && query ? liveQueryDependencyKey(query, models) : "disabled"

  const queryRef = useRef(query)
  const modelsRef = useRef(models)

  queryRef.current = query
  modelsRef.current = models

  const liveQuery = useMemo(() => {
    if (!enabled || !queryRef.current) return null

    return new LiveQuery({debounce, models: modelsRef.current, query: queryRef.current})
  }, [dependencyKey, debounce, enabled])

  useEffect(() => {
    if (!liveQuery) return undefined

    liveQuery.start()

    return () => liveQuery.close()
  }, [liveQuery])

  const subscribe = useCallback((/** @type {() => void} */ listener) => {
    if (!liveQuery) return () => {}

    return liveQuery.subscribe(listener)
  }, [liveQuery])

  const getSnapshot = useCallback(() => {
    if (!liveQuery) return /** @type {LiveQueryState<T>} */ (EMPTY_STATE)

    return liveQuery.getState()
  }, [liveQuery])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
