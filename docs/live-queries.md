# Live queries

`useLiveQuery` lets a screen declare **what** it shows and keeps it current from committed local model changes — no manual refresh plumbing. It is the client-side complement to the sync client: local writes, pulled changes, and realtime pushes all end as local model saves, so the local model layer is the single point every update flows through. Velocious hooks that one point and re-runs the queries that depend on the changed model.

```js
import useLiveQuery from "velocious/build/src/database/use-live-query.js"

const {results: tickets, loading} = useLiveQuery(Ticket.where({eventId}))
```

That is the whole footprint: pass a query, get live results. When any `Ticket` commits locally — a local edit, a pulled change, or a realtime push — the query re-runs and the component re-renders with the new rows.

## The record-change bus

`recordChanges` (`src/database/record-changes.js`) is a framework-level event bus for committed model changes. Every record emits here **once per commit** from `save()`/`destroy()`, deferred through the connection's `afterCommit` hook:

- **Once per commit, not per callback** — the event fires from the save/destroy flow itself, so registering extra lifecycle callbacks does not multiply it.
- **Rollback emits nothing** — the emit is registered on the transaction's `afterCommit` frame, which is discarded on rollback.
- **Free when unobserved** — emission is skipped entirely when nothing is subscribed to the model class (`recordChanges.hasListeners(modelClass)`), so server-side saves and any model no screen is watching carry no live-query overhead.

Emission is uniform across every write path because they all converge on `save()`/`destroy()`: local user writes, the derived pull applier, and the realtime bridge applier.

You can subscribe directly when you need the raw signal:

```js
const unsubscribe = recordChanges.subscribe(Ticket, ({operation, record}) => { /* … */ })
```

## Batching

A sync apply touches many rows. `recordChanges.batch(fn)` opens a coalescing window: every change committed while `fn` runs is buffered and **deduplicated by model class**, then flushed as a single event per changed model class when the outermost batch ends (nested batches share one flush). The sync client wraps its apply loops in this, so:

- a full `SyncClient.pull()` (all scopes/pages) triggers **one** re-run per live query, not one per applied row;
- a realtime push message (`SyncRealtimeBridge.applyMessage`) triggers **one** re-run for its batch.

Outside a batch each commit emits immediately.

## Cost model

Invalidation is **by model class**, not by condition. A change to model `M` schedules a re-run of every live query observing `M`; the query re-runs in full (`query.toArray()`) and its results replace the previous ones. There is no per-condition incremental matcher — the design trades a possibly-unnecessary re-run for a trivial, always-correct matching rule. Re-runs are coalesced (microtask by default, or a trailing `debounce` in ms) and protected against stale responses by a monotonically increasing request id, so an in-flight run superseded by a newer change never overwrites fresher results.

## `useLiveQuery(query, options?)`

```js
const {results, loading, error} = useLiveQuery(query, {active, debounce, models})
```

- **`query`** — any object exposing `getModelClass()` and `toArray()`. `Model.where({...})` (a model-class query) satisfies this directly and, because it also exposes `toSql()`, distinct conditions produce distinct results without any memoization on your part. A custom source without `toSql()` must be a stable/memoized object.
- **`active`** (default `true`) — pass `false` to pause; the hook returns the empty state and holds no subscription.
- **`debounce`** — trailing debounce in ms for re-runs. Defaults to microtask coalescing.
- **`models`** — model classes to observe. Defaults to `[query.getModelClass()]`; pass this to also react to changes on joined models a query reads.

The hook subscribes on mount and unsubscribes on unmount. The reactive engine lives in a React-free controller, `LiveQuery` (`src/database/live-query.js`), which `useLiveQuery` wraps with `useSyncExternalStore`; use `LiveQuery` directly outside React when you need the same live results without a component.

## Replacing manual refresh plumbing

Screens that previously re-fetched on a websocket event, a focus effect, or a manual "reload" callback can drop that wiring: declare the query with `useLiveQuery` and the results stay current from the local model layer. Because pulled and realtime changes both land as local saves, a screen no longer needs to know **how** its data changed — only which query it shows.
