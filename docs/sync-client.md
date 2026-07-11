# Declarative sync client

`SyncClient` (`src/sync/sync-client.js`) is the declarative client-side sync driver. Models declare sync, one configuration block carries the genuinely app-owned hooks, and Velocious derives everything else: the resource map, the sync endpoints, scope persistence, per-scope cursors, pull paging and apply, local queueing, and online-gated replay. There is no hand-written resource map, transport POSTer, or endpoint wiring in app code.

## Declaring sync on models

Models opt in with `static sync`:

```js
class ScannerDevice extends ApplicationRecord {
  static sync = {syncType: "upsert", track: ["create", "update"]}
}

class Ticket extends ApplicationRecord {
  static sync = {findRecord: findTicketByIdOrPytId} // genuine domain logic stays with the model
}

class TicketScan extends ApplicationRecord {
  static sync = true // queueable, all defaults
}
```

`static sync = true` is the complete declaration for most models. Every key in the declaration object is optional and only exists for genuine per-model policy the framework cannot derive:

- `track` — whether local writes auto-queue to the backend. **On by default**: a model declaring `static sync` queues its local creates and updates automatically once the derived client is started. `track: false` opts a model out (for models written by non-user flows that manage their own sync), `track: true` also tracks destroys (queued as `"delete"`), and an operations array or `{operations}` narrows the tracked operations. Writes applying server-originated data do not echo back: the derived pull/realtime appliers suppress themselves, and other apply paths (legacy pulls, importers, sign-in backfills) use `withoutTracking`/`markRemoteApply` (see "Automatic mutation tracking").
- `syncType` — only when the server expects a wire type different from the operation name: the `"upsert"` flag for rows the server upserts by resource id (creates replay as `"update"`), or a function for command-style types (e.g. `scanAttempt`).
- `findRecord` / `findRecordForDelete` — only when pulled changes match local rows by something other than `id` (e.g. a ticket id-or-pytId lookup). The default resolver is find-or-initialize by id.
- `attributes` / `afterApply` — only for models that receive pulled changes and need to map or react to them.
- `localOnlyAttributes` / `booleanAttributes` — only to *extend* the derived sets; the primary key, timestamps, bookkeeping columns, and boolean columns are always derived.
- `trackedData` — only when a tracked payload must carry more than the record's attributes.

## The sync.client configuration block

The only app-side sync configuration is the `sync.client` block — the hooks the framework genuinely cannot know (how to reach the server, who is signed in, whether the device is online, where to report failures):

```js
// configuration.js
new Configuration({
  // ...
  sync: {
    client: {
      authenticationToken: () => getUser().getAuthenticationToken(),
      isOnline: async () => (await Network.getNetworkStateAsync()).isConnected !== false,
      onError: (error) => reportSyncError(error),
      transport: websocketClientAdapter // the frontend-model transport: post(path, body) => Promise<{json: () => object}>
    }
  }
})
```

```js
import {syncClient} from "velocious/build/src/sync/sync-client.js"

await syncClient().start()
```

`syncClient(configuration = Configuration.current())` memoizes one client per configuration and registers it as the current sync client on first construction. `new SyncClient(options)` / `SyncClient.fromConfiguration(configuration, options)` build unmemoized clients from the same derivation; `options` only carries `configuration`, `legacyCursor`, `scopeStore`, and `syncModel` overrides.

## What gets derived

- **resources**: every registered model (`configuration.getModelClasses()`) declaring `static sync`; the resource key is the model name. It is not possible to configure resources by hand.
- **booleanAttributes**: attributes whose columns have boolean types (driver-uniform: `boolean`, `bool`, and MSSQL `bit`).
- **localOnlyAttributes**: the primary key, `createdAt`/`updatedAt`, and sync bookkeeping columns (`lastSyncChangeAt`), merged with any `localOnlyAttributes` declared on the model.
- **tracked payloads**: the default queued data is the record's attributes minus local-only attributes, with booleans coerced and Date values serialized to ISO strings — no per-model payload builders.
- **syncType**: the `"upsert"` flag queues creates and updates as `"update"` rows (the server upserts by resource id) and destroys as `"delete"`; a function stays available for per-operation mapping.
- **syncModel**: the registered `Sync` model (override with `options.syncModel`).
- **endpoints**: the framework owns the `${mountPath}/changes` and `${mountPath}/replay` POSTers over `sync.client.transport` — apps cannot rename them. `sync.client.mountPath` defaults to `"/velocious/sync"` and only exists to match the server's `sync.api.mountPath` when the server mounts the sync endpoints elsewhere (trailing slashes are stripped, like the server's mount normalization).

Missing column metadata, a missing `Sync` model, a missing `sync.client` block, unknown declaration keys, and invalid transports all fail loudly with actionable errors.

Before this derivation existed, apps hand-wrote the whole client config (~160 lines in the scanner app: a resources map, modelClass wiring, boolean/local-only lists, ISO-date payload builders, syncType mappers, `postChanges`/`postReplay` POSTers, auth plumbing). That entire footprint collapses to the `static sync` declarations plus the `sync.client` block above.

## Declaring sync scopes from queries

```js
await syncClient().sync(Event.where({partnerId}))
// or, with a current sync client registered:
await Event.where({partnerId}).sync()
```

The query is serialized into a `{resourceType, conditions}` scope (only plain attribute equality conditions are supported — joins, orders, limits, raw SQL, and negations fail loudly), persisted in the framework-owned `velocious_sync_scopes` table (auto-created; process-local memory when no database is configured), and pulled immediately when online. `pull()` iterates every active scope with its own persisted cursor and sends the scope in each changes request so the server can enforce access per scope. `unsync(query)` / `query.unsync()` deactivates a scope.

Devices migrating from a pre-scope cursor store can seed newly declared scopes through the `legacyCursor({scope})` option, avoiding a full re-pull.

### Pull progress ("X of Y")

`onProgress` reports progress while changes are applied, so a full-import screen can render a "synced of total" bar without a bespoke progress channel. Declaring a scope pulls it immediately, so the initial import of a brand-new scope is reported by `sync()` — pass the callback there:

```js
await syncClient().sync(Ticket.where({eventId}), {
  onProgress: ({pages, syncedCount, total}) => {
    setProgress(`${syncedCount} of ${total}`) // e.g. "800 of 2043"
  }
})
```

`pull({onProgress})` takes the same callback for a later refresh of the already-declared scopes:

```js
await syncClient().pull({onProgress: ({syncedCount, total}) => setProgress(`${syncedCount} of ${total}`)})
```

- `onProgress` is optional — `sync(query)` and `pull()` without it behave exactly as before.
- The callback fires once per applied page with cumulative `{pages, syncedCount, total}` across the pulled scopes (base 0 for a single-scope pull, so a lone scope reads exactly its own counts).
- `total` is the pending change count from the device's cursor to the server snapshot, reported by the change-feed endpoint as a COUNT (it is not materialized). It stays **stable across pages** even as the cursor advances — the denominator does not shrink — because the server counts from each request's cursor and the client adds the rows it already applied.
- A pull with nothing to sync fires `onProgress` once with `{pages: 0, syncedCount: 0, total: 0}`.
- A server that does not report the count leaves `total` at `0` on every page.
- The resolved `pull()` result (and `sync()`'s `pulled`, a `SyncChangesResult`) also carries `total` alongside `syncedCount`/`pages`.

This is the framework path for a full-ticket-import-with-progress screen: declare the scope with `onProgress` and drive the bar straight off it, instead of a hand-rolled full-sync endpoint and progress websocket.

## Automatic mutation tracking

Every model declaring `static sync` queues sync rows automatically when it changes — no app-side queue calls and no `track` key needed:

```js
class TicketScan extends ApplicationRecord {
  static sync = true // local creates and updates queue automatically
}

class Ticket extends ApplicationRecord {
  static sync = {track: false} // written by non-user flows - never auto-queued
}

class ScannerDevice extends ApplicationRecord {
  static sync = {track: true} // also queue destroys (as "delete" sync rows)
}

await syncClient().start() // registers the lifecycle callbacks
```

`start()` registers model lifecycle callbacks for every tracked resource; `stop()` unregisters them. Destroys are not tracked by default because a local destroy is often cache eviction rather than a server delete — `track: true` opts in, and an operations array (`track: ["update"]`) or `{operations}` narrows the tracked operations.

Queueing runs through the model connection's `afterCommit` hook, so a tracked mutation only queues once its transaction has committed (immediately when no transaction is open) — queued syncs never reference rolled-back rows, and the immediate replay attempt cannot race an uncommitted transaction.

Records written by the derived pull/realtime appliers are excluded (echo suppression), so applying remote changes never queues them back to the server. Any other code applying server-originated data — legacy pull paths, importers, sign-in backfills — suppresses echo-queueing the same way through the public API:

```js
await syncClient().withoutTracking(async () => {
  // every tracked mutation in here is skipped, across awaits; nested calls stack
  await applyLegacyPull()
})

// record-precise form (what the derived appliers use internally):
const release = syncClient().markRemoteApply(record)
try {
  record.assign(attributesFromServer)
  await record.save()
} finally {
  release()
}
```

`withoutTracking` suppression is client-wide while its callback runs, so mutations from concurrently running tasks are also skipped for that window — prefer `markRemoteApply(record)` when writes from other flows can interleave.

## Local changes and replay

```js
await syncClient().queue({resource: ticketScan, syncType: "scanAttempt"})
```

Automatic tracking covers ordinary creates/updates, so most models never call `queue()`. Explicit `queue()` stays available for command-style mutations whose payload carries more than the record's attributes (e.g. a `scanAttempt` with device context).

`queue()` persists a pending row on the derived `Sync` model (stripping local-only attributes, coercing booleans) and schedules an immediate background replay. Replays are single-flighted and online-gated; rows are marked successful only after the backend acknowledges them, so offline or rejected changes stay pending for the next attempt. Background failures go to the `sync.client.onError` hook (rethrown when none is configured). `waitForScheduledReplay()` awaits the last scheduled attempt (useful in tests and shutdown flows).

## Realtime

`subscribeRealtime()` bridges server websocket pushes into the same derived apply path as pulls — no hand-written websocket apply code and no channel wiring in apps. Every declared pull scope subscribes the framework-owned `velocious-sync` channel automatically: the subscribe params mirror the scope's `{resourceType, conditions}`, and the server authorizes the subscription through the app sync resource's existing `authorizeChanges({params, scope})` — the same authorization pulls already go through. The app footprint shrinks to the callbacks the framework genuinely cannot know (how to build the websocket client, what this device's echo origin is):

```js
// configuration.js
new Configuration({
  sync: {
    client: {
      // ...transport, authenticationToken, isOnline, onError
      realtime: {
        createClient: () => new VelociousWebsocketClient({autoReconnect: true, networkMonitor, url}),
        localOrigin: () => getDeviceId()
      }
    }
  }
})
```

```js
await syncClient().sync(Ticket.where({eventId}))
await syncClient().subscribeRealtime()
// ...
await syncClient().unsubscribeRealtime()
```

- **createClient** builds the (unconnected) websocket client; the framework owns connect, subscribe, and disconnect.
- **Scope subscriptions are derived**: at subscribe time, every active scope from `sync(query)` becomes one `velocious-sync` subscription, with the scope's conditions translated to the model's attribute names so they match the publisher's scoping params. Declare scopes before subscribing (or resubscribe after declaring new ones). Framework broadcasts route per resource type, so declare one scope per synced resource type that should receive realtime pushes. The framework injects `authenticationToken` into every subscription's params; declaring your own `authenticationToken` param is an error, so a stale app-supplied token can never silently replace the freshly resolved one.
- **Pushed messages are sync envelopes** — `{syncType, resourceId, data, resourceType?, echoOrigin?}` or `{echoOrigin, syncs: [...]}` batches (the shape the server publisher broadcasts) — and apply through the same derived resource applier as pulls: the model's `attributes`/`findRecord`/`findRecordForDelete`/`afterApply` policy, echo suppression so tracked models never re-queue applied pushes, and loud failure on unconfigured resource types. Envelopes without a `resourceType` default to the channel's declared `resourceType`. Messages apply serially in arrival order; failures go to `sync.client.onError` (rethrown when none is configured).
- **localOrigin** drops own-device messages: a pushed `echoOrigin` matching the resolved local origin is ignored.
- **pullOnReconnect** (default true): when subscriptions become ready or resume after a connection drop, a coalesced single `pull()` closes the offline gap. The gap-closing pull only fires after every subscription is server-acknowledged (`waitForReady`), so no change can land between the pull and the subscriptions going live; pushes arriving before acknowledgement still apply. Low-level reconnect/backoff stays in the websocket client.
- `subscribeRealtime(context)` is idempotent and single-flighted, and resolves once every channel subscription is acknowledged — call `unsubscribeRealtime()` first to change the context. Unsubscribing while a subscribe is still in flight cancels that attempt: the bridge tears down anything it created and stays unsubscribed. `realtimeStatus()` reports `{state, channels: [{channel, resourceType, ready}]}`. `waitForRealtimeApplied()` awaits pending applies and any scheduled pull (tests, shutdown flows).

### Shared connection (one socket for everything)

A client should open one websocket for everything — events, sync, subscriptions. Configure a shared app-lifetime connection on `sync.client` and all sync traffic rides it:

```js
new Configuration({
  sync: {
    client: {
      // ...transport, authenticationToken
      websocketUrl: "ws://localhost:3006/websocket" // framework builds and owns one reconnecting VelociousWebsocketClient
    }
  }
})
```

- **`websocketUrl`** (string or `() => string`): the framework builds one reconnecting `VelociousWebsocketClient`, connected on first use and memoized for the app's lifetime.
- **`websocketClient`** (the low-level form): pass an already-built websocket client instance instead. Give it the **same** instance your frontend-model transport uses (`configureTransport({websocketClient})`) so a single socket carries frontend-model traffic *and* sync — the frontend-model client can *be* the shared connection.
- `syncClient().syncConnection()` returns the shared connection (or null when none is configured), building it once.
- With a shared connection, the realtime bridge **rides it without owning its lifecycle**: `unsubscribeRealtime()` closes only its channel subscriptions and leaves the socket open (a subsequent subscribe resubscribes over the same socket). Low-level reconnect/backoff stays in the websocket client.
- The deprecated per-cycle `realtime.createClient` still works when no shared connection is configured: the bridge builds its own client per subscribe cycle and disconnects it on unsubscribe (unchanged).

## User scope: subscribe to everything the user can see

Instead of declaring a scope per event when a screen opens, sign-in can subscribe to *everything the signed-in user's ability can see* — the server enumerates membership. The client subscribes once with just its token; the server decides.

```js
// on sign-in
await syncClient().subscribeUserScope()

// on sign-out
await syncClient().unsubscribeUserScope()
```

- `subscribeUserScope()` declares **one** user scope — empty conditions and **no resource type** — covering every type the server authorizes for the caller, subscribes realtime so its framework `velocious-sync` subscription goes live, and pulls so the device catches up. Idempotent and single-flighted like `subscribeRealtime()`.
- **One scope, not one per type.** The scope's `resourceType` is `null`, so a sync is a single `/changes` request and a single channel subscription however many resource types it serves. That matters because the server re-runs the app's `authorizeChanges` on every changes request and every subscribe: with a scope per type, each added user-scope resource type multiplies that authorization work (for an app resolving membership against an external database, that is real per-sign-in load). The client applies each pulled row by the resource type carried on its own envelope, so a single scope serves them all.
- The server authorizes the scope through the app sync resource's existing `authorizeChanges({params, scope})` (the app decides whether user scopes are allowed, and `scope.resourceType === null` identifies the user scope), and re-checks record access **per delivery** at broadcast fan-out: a user-scope subscription matches every broadcast, and each published change is filtered through the sync resource's `changeDeliverable`, which reuses the app's `scopeChangesQuery` ability scoping. Two users with disjoint access each receive only their own changes over the one connection.
- Pulls for the user scope post empty conditions, so the app's `scopeChangesQuery` falls back to ability scoping; the per-scope cursor still applies, so a sign-out/sign-in cycle resumes from the cursor instead of re-pulling everything.
- `unsubscribeUserScope()` deactivates the user scope and closes the realtime channel subscriptions **without disconnecting** the shared connection, so sign-out drops subscriptions but keeps the socket for the next sign-in.
- A background pull — the catch-up pull a realtime resume schedules, which nobody awaits — reports its failures through the sync client's error reporter. A transient server error there never escapes as an unhandled rejection.

### Deprecated legacy channels

Before the framework sync channel, apps declared their own channels; both forms keep working as escape hatches for legacy app channels but are deprecated: the `sync.client.realtime.channels(context)` callback (runtime params come from the `subscribeRealtime(context)` context) and the model-level `static sync = {realtime: {channel, params}}` declaration. Legacy channels subscribe in addition to the scope-derived framework subscriptions.

## Live queries

Screens do not subscribe to the sync client to stay current. Because pulls and realtime pushes both apply as local model saves, the client-side `useLiveQuery(Model.where({...}))` hook reacts to committed local model changes uniformly — the sync client wraps its pull and realtime apply loops in the record-change batch window so a whole pull or push triggers one re-run per live query. See `docs/live-queries.md`.

## Server side

The server counterpart is `SyncResourceBase` (`src/sync/sync-resource-base.js`) plus the auto-mounted sync endpoints (`sync.api` configuration option) — see `docs/offline-sync.md`.

The server mirror of automatic mutation tracking is `SyncPublisher` (`src/sync/sync-publisher.js`): server models declare a `publish` config in the same `static sync` declaration (the client ignores the key), and server-side writes publish to the sync change feed and broadcast the standard sync envelope on the framework `velocious-sync` channel automatically once their transaction commits — see the server publish-by-default and framework sync channel slice in `docs/offline-sync.md`.
