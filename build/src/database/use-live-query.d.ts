export type RecordModelClass = typeof import("./record/index.js").default;
export type LiveQuerySource<T> = import("./live-query.js").LiveQuerySource<T>;
export type LiveQueryState<T> = import("./live-query.js").LiveQueryState<T>;
export type UseLiveQueryOptions = {
    /**
     * - Whether the query is active. Default true; pass false to pause and return the empty state.
     */
    active?: boolean;
    /**
     * - Trailing debounce in ms for re-runs. Defaults to microtask coalescing.
     */
    debounce?: number;
    /**
     * - Model classes to observe. Defaults to the query's model class; pass this to also react to joined models.
     */
    models?: RecordModelClass[];
};
/**
 * React hook declaring what a screen shows and keeping it current from committed
 * local model changes. Runs `query.toArray()` once, subscribes to the query's
 * model class(es) on the record-change bus, and re-runs (coalesced, stale-safe)
 * whenever a watched model commits — so local writes, pull applies, and realtime
 * applies all refresh the results without any manual refresh plumbing.
 * @template T
 * @param {(LiveQuerySource<T> & {toSql?: () => ReturnType<typeof JSON.parse>}) | null | undefined} query - Query source, e.g. `Model.where({...})`.
 * @param {UseLiveQueryOptions} [options] - Hook options.
 * @returns {LiveQueryState<T>} Current results, loading, and last error.
 */
export default function useLiveQuery<T>(query: (LiveQuerySource<T> & {
    toSql?: () => ReturnType<typeof JSON.parse>;
}) | null | undefined, options?: UseLiveQueryOptions): LiveQueryState<T>;
//# sourceMappingURL=use-live-query.d.ts.map