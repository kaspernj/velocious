// @ts-check
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import LiveQuery from "./live-query.js";
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
 * @type {LiveQueryState<ReturnType<typeof JSON.parse>>} */
const EMPTY_STATE = { error: null, loading: false, results: [] };
/**
 * Assigns and stores a stable identity key for query sources without a `toSql`.
 * @type {WeakMap<object, string>} */
const queryIdentityKeys = new WeakMap();
/**
 * Monotonic counter backing the queryIdentityKeys registry.
 * @type {number} */
let nextQueryIdentity = 0;
/**
 * Builds a dependency key identifying a query's semantics so the underlying
 * controller is rebuilt when they change. Model-class queries expose `toSql`, so
 * distinct conditions yield distinct keys; other sources fall back to a stable
 * per-object identity (such sources must be memoized by the caller).
 * @param {LiveQuerySource<ReturnType<typeof JSON.parse>> & {toSql?: () => ReturnType<typeof JSON.parse>}} query - Query source.
 * @param {RecordModelClass[] | undefined} models - Explicit model classes to observe.
 * @returns {string} Dependency key.
 */
function liveQueryDependencyKey(query, models) {
    const modelNames = (models ?? [query.getModelClass()]).map((modelClass) => modelClass.getModelName()).join(",");
    if (typeof query.toSql === "function")
        return `${modelNames}::${String(query.toSql())}`;
    let identityKey = queryIdentityKeys.get(query);
    if (identityKey === undefined) {
        identityKey = `#${++nextQueryIdentity}`;
        queryIdentityKeys.set(query, identityKey);
    }
    return `${modelNames}::${identityKey}`;
}
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
export default function useLiveQuery(query, options = {}) {
    const { active = true, debounce, models } = options;
    const enabled = active && Boolean(query);
    const dependencyKey = enabled && query ? liveQueryDependencyKey(query, models) : "disabled";
    const queryRef = useRef(query);
    const modelsRef = useRef(models);
    queryRef.current = query;
    modelsRef.current = models;
    const liveQuery = useMemo(() => {
        if (!enabled || !queryRef.current)
            return null;
        return new LiveQuery({ debounce, models: modelsRef.current, query: queryRef.current });
    }, [dependencyKey, debounce, enabled]);
    useEffect(() => {
        if (!liveQuery)
            return undefined;
        liveQuery.start();
        return () => liveQuery.close();
    }, [liveQuery]);
    const subscribe = useCallback((/** @type {() => void} */ listener) => {
        if (!liveQuery)
            return () => { };
        return liveQuery.subscribe(listener);
    }, [liveQuery]);
    const getSnapshot = useCallback(() => {
        if (!liveQuery)
            return /** @type {LiveQueryState<T>} */ (EMPTY_STATE);
        return liveQuery.getState();
    }, [liveQuery]);
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXNlLWxpdmUtcXVlcnkuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZGF0YWJhc2UvdXNlLWxpdmUtcXVlcnkuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyxXQUFXLEVBQUUsU0FBUyxFQUFFLE9BQU8sRUFBRSxNQUFNLEVBQUUsb0JBQW9CLEVBQUMsTUFBTSxPQUFPLENBQUE7QUFFbkYsT0FBTyxTQUFTLE1BQU0saUJBQWlCLENBQUE7QUFFdkM7OzRFQUU0RTtBQUU1RTs7OzZFQUc2RTtBQUU3RTs7OzJFQUcyRTtBQUUzRTs7Ozs7O0dBTUc7QUFFSDs7OzJEQUcyRDtBQUMzRCxNQUFNLFdBQVcsR0FBRyxFQUFDLEtBQUssRUFBRSxJQUFJLEVBQUUsT0FBTyxFQUFFLEtBQUssRUFBRSxPQUFPLEVBQUUsRUFBRSxFQUFDLENBQUE7QUFFOUQ7O3FDQUVxQztBQUNyQyxNQUFNLGlCQUFpQixHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7QUFFdkM7O29CQUVvQjtBQUNwQixJQUFJLGlCQUFpQixHQUFHLENBQUMsQ0FBQTtBQUV6Qjs7Ozs7Ozs7R0FRRztBQUNILFNBQVMsc0JBQXNCLENBQUMsS0FBSyxFQUFFLE1BQU07SUFDM0MsTUFBTSxVQUFVLEdBQUcsQ0FBQyxNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsYUFBYSxFQUFFLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLFVBQVUsRUFBRSxFQUFFLENBQUMsVUFBVSxDQUFDLFlBQVksRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFBO0lBRS9HLElBQUksT0FBTyxLQUFLLENBQUMsS0FBSyxLQUFLLFVBQVU7UUFBRSxPQUFPLEdBQUcsVUFBVSxLQUFLLE1BQU0sQ0FBQyxLQUFLLENBQUMsS0FBSyxFQUFFLENBQUMsRUFBRSxDQUFBO0lBRXZGLElBQUksV0FBVyxHQUFHLGlCQUFpQixDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQTtJQUU5QyxJQUFJLFdBQVcsS0FBSyxTQUFTLEVBQUUsQ0FBQztRQUM5QixXQUFXLEdBQUcsSUFBSSxFQUFFLGlCQUFpQixFQUFFLENBQUE7UUFDdkMsaUJBQWlCLENBQUMsR0FBRyxDQUFDLEtBQUssRUFBRSxXQUFXLENBQUMsQ0FBQTtJQUMzQyxDQUFDO0lBRUQsT0FBTyxHQUFHLFVBQVUsS0FBSyxXQUFXLEVBQUUsQ0FBQTtBQUN4QyxDQUFDO0FBRUQ7Ozs7Ozs7Ozs7R0FVRztBQUNILE1BQU0sQ0FBQyxPQUFPLFVBQVUsWUFBWSxDQUFDLEtBQUssRUFBRSxPQUFPLEdBQUcsRUFBRTtJQUN0RCxNQUFNLEVBQUMsTUFBTSxHQUFHLElBQUksRUFBRSxRQUFRLEVBQUUsTUFBTSxFQUFDLEdBQUcsT0FBTyxDQUFBO0lBQ2pELE1BQU0sT0FBTyxHQUFHLE1BQU0sSUFBSSxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUE7SUFDeEMsTUFBTSxhQUFhLEdBQUcsT0FBTyxJQUFJLEtBQUssQ0FBQyxDQUFDLENBQUMsc0JBQXNCLENBQUMsS0FBSyxFQUFFLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUE7SUFFM0YsTUFBTSxRQUFRLEdBQUcsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFBO0lBQzlCLE1BQU0sU0FBUyxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQTtJQUVoQyxRQUFRLENBQUMsT0FBTyxHQUFHLEtBQUssQ0FBQTtJQUN4QixTQUFTLENBQUMsT0FBTyxHQUFHLE1BQU0sQ0FBQTtJQUUxQixNQUFNLFNBQVMsR0FBRyxPQUFPLENBQUMsR0FBRyxFQUFFO1FBQzdCLElBQUksQ0FBQyxPQUFPLElBQUksQ0FBQyxRQUFRLENBQUMsT0FBTztZQUFFLE9BQU8sSUFBSSxDQUFBO1FBRTlDLE9BQU8sSUFBSSxTQUFTLENBQUMsRUFBQyxRQUFRLEVBQUUsTUFBTSxFQUFFLFNBQVMsQ0FBQyxPQUFPLEVBQUUsS0FBSyxFQUFFLFFBQVEsQ0FBQyxPQUFPLEVBQUMsQ0FBQyxDQUFBO0lBQ3RGLENBQUMsRUFBRSxDQUFDLGFBQWEsRUFBRSxRQUFRLEVBQUUsT0FBTyxDQUFDLENBQUMsQ0FBQTtJQUV0QyxTQUFTLENBQUMsR0FBRyxFQUFFO1FBQ2IsSUFBSSxDQUFDLFNBQVM7WUFBRSxPQUFPLFNBQVMsQ0FBQTtRQUVoQyxTQUFTLENBQUMsS0FBSyxFQUFFLENBQUE7UUFFakIsT0FBTyxHQUFHLEVBQUUsQ0FBQyxTQUFTLENBQUMsS0FBSyxFQUFFLENBQUE7SUFDaEMsQ0FBQyxFQUFFLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQTtJQUVmLE1BQU0sU0FBUyxHQUFHLFdBQVcsQ0FBQyxDQUFDLHlCQUF5QixDQUFDLFFBQVEsRUFBRSxFQUFFO1FBQ25FLElBQUksQ0FBQyxTQUFTO1lBQUUsT0FBTyxHQUFHLEVBQUUsR0FBRSxDQUFDLENBQUE7UUFFL0IsT0FBTyxTQUFTLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxDQUFBO0lBQ3RDLENBQUMsRUFBRSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUE7SUFFZixNQUFNLFdBQVcsR0FBRyxXQUFXLENBQUMsR0FBRyxFQUFFO1FBQ25DLElBQUksQ0FBQyxTQUFTO1lBQUUsT0FBTyxnQ0FBZ0MsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxDQUFBO1FBRXJFLE9BQU8sU0FBUyxDQUFDLFFBQVEsRUFBRSxDQUFBO0lBQzdCLENBQUMsRUFBRSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUE7SUFFZixPQUFPLG9CQUFvQixDQUFDLFNBQVMsRUFBRSxXQUFXLEVBQUUsV0FBVyxDQUFDLENBQUE7QUFDbEUsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge3VzZUNhbGxiYWNrLCB1c2VFZmZlY3QsIHVzZU1lbW8sIHVzZVJlZiwgdXNlU3luY0V4dGVybmFsU3RvcmV9IGZyb20gXCJyZWFjdFwiXG5cbmltcG9ydCBMaXZlUXVlcnkgZnJvbSBcIi4vbGl2ZS1xdWVyeS5qc1wiXG5cbi8qKlxuICogUmVjb3JkTW9kZWxDbGFzcyB0eXBlLlxuICogQHR5cGVkZWYge3R5cGVvZiBpbXBvcnQoXCIuL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBSZWNvcmRNb2RlbENsYXNzICovXG5cbi8qKlxuICogTGl2ZVF1ZXJ5U291cmNlIHR5cGUuXG4gKiBAdGVtcGxhdGUgVFxuICogQHR5cGVkZWYge2ltcG9ydChcIi4vbGl2ZS1xdWVyeS5qc1wiKS5MaXZlUXVlcnlTb3VyY2U8VD59IExpdmVRdWVyeVNvdXJjZSAqL1xuXG4vKipcbiAqIExpdmVRdWVyeVN0YXRlIHR5cGUuXG4gKiBAdGVtcGxhdGUgVFxuICogQHR5cGVkZWYge2ltcG9ydChcIi4vbGl2ZS1xdWVyeS5qc1wiKS5MaXZlUXVlcnlTdGF0ZTxUPn0gTGl2ZVF1ZXJ5U3RhdGUgKi9cblxuLyoqXG4gKiBVc2VMaXZlUXVlcnlPcHRpb25zIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBVc2VMaXZlUXVlcnlPcHRpb25zXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFthY3RpdmVdIC0gV2hldGhlciB0aGUgcXVlcnkgaXMgYWN0aXZlLiBEZWZhdWx0IHRydWU7IHBhc3MgZmFsc2UgdG8gcGF1c2UgYW5kIHJldHVybiB0aGUgZW1wdHkgc3RhdGUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW2RlYm91bmNlXSAtIFRyYWlsaW5nIGRlYm91bmNlIGluIG1zIGZvciByZS1ydW5zLiBEZWZhdWx0cyB0byBtaWNyb3Rhc2sgY29hbGVzY2luZy5cbiAqIEBwcm9wZXJ0eSB7UmVjb3JkTW9kZWxDbGFzc1tdfSBbbW9kZWxzXSAtIE1vZGVsIGNsYXNzZXMgdG8gb2JzZXJ2ZS4gRGVmYXVsdHMgdG8gdGhlIHF1ZXJ5J3MgbW9kZWwgY2xhc3M7IHBhc3MgdGhpcyB0byBhbHNvIHJlYWN0IHRvIGpvaW5lZCBtb2RlbHMuXG4gKi9cblxuLyoqXG4gKiBTdGFibGUgZW1wdHkgc3RhdGUgcmV0dXJuZWQgd2hpbGUgdGhlcmUgaXMgbm8gYWN0aXZlIHF1ZXJ5LCBzbyBhIHBhdXNlZCBob29rXG4gKiBrZWVwcyBhIHJlZmVyZW50aWFsbHkgc3RhYmxlIHNuYXBzaG90IGZvciBgdXNlU3luY0V4dGVybmFsU3RvcmVgLlxuICogQHR5cGUge0xpdmVRdWVyeVN0YXRlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbmNvbnN0IEVNUFRZX1NUQVRFID0ge2Vycm9yOiBudWxsLCBsb2FkaW5nOiBmYWxzZSwgcmVzdWx0czogW119XG5cbi8qKlxuICogQXNzaWducyBhbmQgc3RvcmVzIGEgc3RhYmxlIGlkZW50aXR5IGtleSBmb3IgcXVlcnkgc291cmNlcyB3aXRob3V0IGEgYHRvU3FsYC5cbiAqIEB0eXBlIHtXZWFrTWFwPG9iamVjdCwgc3RyaW5nPn0gKi9cbmNvbnN0IHF1ZXJ5SWRlbnRpdHlLZXlzID0gbmV3IFdlYWtNYXAoKVxuXG4vKipcbiAqIE1vbm90b25pYyBjb3VudGVyIGJhY2tpbmcgdGhlIHF1ZXJ5SWRlbnRpdHlLZXlzIHJlZ2lzdHJ5LlxuICogQHR5cGUge251bWJlcn0gKi9cbmxldCBuZXh0UXVlcnlJZGVudGl0eSA9IDBcblxuLyoqXG4gKiBCdWlsZHMgYSBkZXBlbmRlbmN5IGtleSBpZGVudGlmeWluZyBhIHF1ZXJ5J3Mgc2VtYW50aWNzIHNvIHRoZSB1bmRlcmx5aW5nXG4gKiBjb250cm9sbGVyIGlzIHJlYnVpbHQgd2hlbiB0aGV5IGNoYW5nZS4gTW9kZWwtY2xhc3MgcXVlcmllcyBleHBvc2UgYHRvU3FsYCwgc29cbiAqIGRpc3RpbmN0IGNvbmRpdGlvbnMgeWllbGQgZGlzdGluY3Qga2V5czsgb3RoZXIgc291cmNlcyBmYWxsIGJhY2sgdG8gYSBzdGFibGVcbiAqIHBlci1vYmplY3QgaWRlbnRpdHkgKHN1Y2ggc291cmNlcyBtdXN0IGJlIG1lbW9pemVkIGJ5IHRoZSBjYWxsZXIpLlxuICogQHBhcmFtIHtMaXZlUXVlcnlTb3VyY2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+ICYge3RvU3FsPzogKCkgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSBxdWVyeSAtIFF1ZXJ5IHNvdXJjZS5cbiAqIEBwYXJhbSB7UmVjb3JkTW9kZWxDbGFzc1tdIHwgdW5kZWZpbmVkfSBtb2RlbHMgLSBFeHBsaWNpdCBtb2RlbCBjbGFzc2VzIHRvIG9ic2VydmUuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBEZXBlbmRlbmN5IGtleS5cbiAqL1xuZnVuY3Rpb24gbGl2ZVF1ZXJ5RGVwZW5kZW5jeUtleShxdWVyeSwgbW9kZWxzKSB7XG4gIGNvbnN0IG1vZGVsTmFtZXMgPSAobW9kZWxzID8/IFtxdWVyeS5nZXRNb2RlbENsYXNzKCldKS5tYXAoKG1vZGVsQ2xhc3MpID0+IG1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCkpLmpvaW4oXCIsXCIpXG5cbiAgaWYgKHR5cGVvZiBxdWVyeS50b1NxbCA9PT0gXCJmdW5jdGlvblwiKSByZXR1cm4gYCR7bW9kZWxOYW1lc306OiR7U3RyaW5nKHF1ZXJ5LnRvU3FsKCkpfWBcblxuICBsZXQgaWRlbnRpdHlLZXkgPSBxdWVyeUlkZW50aXR5S2V5cy5nZXQocXVlcnkpXG5cbiAgaWYgKGlkZW50aXR5S2V5ID09PSB1bmRlZmluZWQpIHtcbiAgICBpZGVudGl0eUtleSA9IGAjJHsrK25leHRRdWVyeUlkZW50aXR5fWBcbiAgICBxdWVyeUlkZW50aXR5S2V5cy5zZXQocXVlcnksIGlkZW50aXR5S2V5KVxuICB9XG5cbiAgcmV0dXJuIGAke21vZGVsTmFtZXN9Ojoke2lkZW50aXR5S2V5fWBcbn1cblxuLyoqXG4gKiBSZWFjdCBob29rIGRlY2xhcmluZyB3aGF0IGEgc2NyZWVuIHNob3dzIGFuZCBrZWVwaW5nIGl0IGN1cnJlbnQgZnJvbSBjb21taXR0ZWRcbiAqIGxvY2FsIG1vZGVsIGNoYW5nZXMuIFJ1bnMgYHF1ZXJ5LnRvQXJyYXkoKWAgb25jZSwgc3Vic2NyaWJlcyB0byB0aGUgcXVlcnknc1xuICogbW9kZWwgY2xhc3MoZXMpIG9uIHRoZSByZWNvcmQtY2hhbmdlIGJ1cywgYW5kIHJlLXJ1bnMgKGNvYWxlc2NlZCwgc3RhbGUtc2FmZSlcbiAqIHdoZW5ldmVyIGEgd2F0Y2hlZCBtb2RlbCBjb21taXRzIOKAlCBzbyBsb2NhbCB3cml0ZXMsIHB1bGwgYXBwbGllcywgYW5kIHJlYWx0aW1lXG4gKiBhcHBsaWVzIGFsbCByZWZyZXNoIHRoZSByZXN1bHRzIHdpdGhvdXQgYW55IG1hbnVhbCByZWZyZXNoIHBsdW1iaW5nLlxuICogQHRlbXBsYXRlIFRcbiAqIEBwYXJhbSB7KExpdmVRdWVyeVNvdXJjZTxUPiAmIHt0b1NxbD86ICgpID0+IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSkgfCBudWxsIHwgdW5kZWZpbmVkfSBxdWVyeSAtIFF1ZXJ5IHNvdXJjZSwgZS5nLiBgTW9kZWwud2hlcmUoey4uLn0pYC5cbiAqIEBwYXJhbSB7VXNlTGl2ZVF1ZXJ5T3B0aW9uc30gW29wdGlvbnNdIC0gSG9vayBvcHRpb25zLlxuICogQHJldHVybnMge0xpdmVRdWVyeVN0YXRlPFQ+fSBDdXJyZW50IHJlc3VsdHMsIGxvYWRpbmcsIGFuZCBsYXN0IGVycm9yLlxuICovXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiB1c2VMaXZlUXVlcnkocXVlcnksIG9wdGlvbnMgPSB7fSkge1xuICBjb25zdCB7YWN0aXZlID0gdHJ1ZSwgZGVib3VuY2UsIG1vZGVsc30gPSBvcHRpb25zXG4gIGNvbnN0IGVuYWJsZWQgPSBhY3RpdmUgJiYgQm9vbGVhbihxdWVyeSlcbiAgY29uc3QgZGVwZW5kZW5jeUtleSA9IGVuYWJsZWQgJiYgcXVlcnkgPyBsaXZlUXVlcnlEZXBlbmRlbmN5S2V5KHF1ZXJ5LCBtb2RlbHMpIDogXCJkaXNhYmxlZFwiXG5cbiAgY29uc3QgcXVlcnlSZWYgPSB1c2VSZWYocXVlcnkpXG4gIGNvbnN0IG1vZGVsc1JlZiA9IHVzZVJlZihtb2RlbHMpXG5cbiAgcXVlcnlSZWYuY3VycmVudCA9IHF1ZXJ5XG4gIG1vZGVsc1JlZi5jdXJyZW50ID0gbW9kZWxzXG5cbiAgY29uc3QgbGl2ZVF1ZXJ5ID0gdXNlTWVtbygoKSA9PiB7XG4gICAgaWYgKCFlbmFibGVkIHx8ICFxdWVyeVJlZi5jdXJyZW50KSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIG5ldyBMaXZlUXVlcnkoe2RlYm91bmNlLCBtb2RlbHM6IG1vZGVsc1JlZi5jdXJyZW50LCBxdWVyeTogcXVlcnlSZWYuY3VycmVudH0pXG4gIH0sIFtkZXBlbmRlbmN5S2V5LCBkZWJvdW5jZSwgZW5hYmxlZF0pXG5cbiAgdXNlRWZmZWN0KCgpID0+IHtcbiAgICBpZiAoIWxpdmVRdWVyeSkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgbGl2ZVF1ZXJ5LnN0YXJ0KClcblxuICAgIHJldHVybiAoKSA9PiBsaXZlUXVlcnkuY2xvc2UoKVxuICB9LCBbbGl2ZVF1ZXJ5XSlcblxuICBjb25zdCBzdWJzY3JpYmUgPSB1c2VDYWxsYmFjaygoLyoqIEB0eXBlIHsoKSA9PiB2b2lkfSAqLyBsaXN0ZW5lcikgPT4ge1xuICAgIGlmICghbGl2ZVF1ZXJ5KSByZXR1cm4gKCkgPT4ge31cblxuICAgIHJldHVybiBsaXZlUXVlcnkuc3Vic2NyaWJlKGxpc3RlbmVyKVxuICB9LCBbbGl2ZVF1ZXJ5XSlcblxuICBjb25zdCBnZXRTbmFwc2hvdCA9IHVzZUNhbGxiYWNrKCgpID0+IHtcbiAgICBpZiAoIWxpdmVRdWVyeSkgcmV0dXJuIC8qKiBAdHlwZSB7TGl2ZVF1ZXJ5U3RhdGU8VD59ICovIChFTVBUWV9TVEFURSlcblxuICAgIHJldHVybiBsaXZlUXVlcnkuZ2V0U3RhdGUoKVxuICB9LCBbbGl2ZVF1ZXJ5XSlcblxuICByZXR1cm4gdXNlU3luY0V4dGVybmFsU3RvcmUoc3Vic2NyaWJlLCBnZXRTbmFwc2hvdCwgZ2V0U25hcHNob3QpXG59XG4iXX0=