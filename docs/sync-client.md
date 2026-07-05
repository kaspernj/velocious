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

- `track` — whether local writes auto-queue to the backend. Off by default on purpose: models that are also written by pull/import/sign-in flows must not echo those writes back to the server as device changes. Turn it on (`true`, an operations array, or `{operations}`) for models whose local mutations *are* device changes (scan rows, device status).
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

## Automatic mutation tracking

Models with `track` in their `static sync` declaration queue sync rows automatically when they change — no app-side queue calls:

```js
class TicketScan extends ApplicationRecord {
  static sync = {
    track: true, // or ["update"] / {operations: ["update"]}
    syncType: ({operation}) => operation === "create" ? "scanAttempt" : "update"
  }
}

await syncClient().start() // registers afterCreate/afterUpdate/afterDestroy callbacks
```

`start()` registers model lifecycle callbacks for every tracked resource (destroys queue `"delete"` sync rows); `stop()` unregisters them. Records written by pull-apply are excluded (echo suppression), so applying remote changes never queues them back to the server.

## Local changes and replay

```js
await syncClient().queue({resource: ticketScan, syncType: "scanAttempt"})
```

Explicit `queue()` stays available for command-style mutations whose payload carries more than the record's attributes.

`queue()` persists a pending row on the derived `Sync` model (stripping local-only attributes, coercing booleans) and schedules an immediate background replay. Replays are single-flighted and online-gated; rows are marked successful only after the backend acknowledges them, so offline or rejected changes stay pending for the next attempt. Background failures go to the `sync.client.onError` hook (rethrown when none is configured). `waitForScheduledReplay()` awaits the last scheduled attempt (useful in tests and shutdown flows).

## Realtime

`subscribeRealtime()` bridges server websocket pushes into the same derived apply path as pulls — no hand-written websocket apply code in apps. The app footprint is the realtime callbacks the framework genuinely cannot know (how to build the websocket client, which channels with which runtime params, what this device's echo origin is):

```js
// configuration.js
new Configuration({
  sync: {
    client: {
      // ...transport, authenticationToken, isOnline, onError
      realtime: {
        createClient: () => new VelociousWebsocketClient({autoReconnect: true, networkMonitor, url}),
        channels: ({eventId}) => [{channel: "ticket-scans", params: {eventID: eventId}, resourceType: "TicketScan"}],
        localOrigin: () => getScannerDeviceId()
      }
    }
  }
})
```

```js
await syncClient().subscribeRealtime({eventId})
// ...
await syncClient().unsubscribeRealtime()
```

- **createClient** builds the (unconnected) websocket client; the framework owns connect, subscribe, and disconnect. **channels(context)** resolves the subscriptions from the `subscribeRealtime(context)` context because channel params are runtime values (an eventId, a mandantenNr). A model whose channel name and params are genuinely static can declare it on the model instead — `static sync = {realtime: {channel: "scanner-devices"}}` — and skip the callback entirely. The framework injects `authenticationToken` into every subscription's params; declaring your own `authenticationToken` param is an error, so a stale app-supplied token can never silently replace the freshly resolved one.
- **Pushed messages are sync envelopes** — `{syncType, resourceId, data, resourceType?, echoOrigin?}` or `{syncs: [...]}` batches — and apply through the same derived resource applier as pulls: the model's `attributes`/`findRecord`/`findRecordForDelete`/`afterApply` policy, echo suppression so tracked models never re-queue applied pushes, and loud failure on unconfigured resource types. Envelopes without a `resourceType` default to the channel's declared `resourceType`. Messages apply serially in arrival order; failures go to `sync.client.onError` (rethrown when none is configured).
- **localOrigin** drops own-device messages: a pushed `echoOrigin` matching the resolved local origin is ignored.
- **pullOnReconnect** (default true): when subscriptions become ready or resume after a connection drop, a coalesced single `pull()` closes the offline gap. The gap-closing pull only fires after every subscription is server-acknowledged (`waitForReady`), so no change can land between the pull and the subscriptions going live; pushes arriving before acknowledgement still apply. Low-level reconnect/backoff stays in the websocket client.
- `subscribeRealtime(context)` is idempotent and single-flighted, and resolves once every channel subscription is acknowledged — call `unsubscribeRealtime()` first to change the context. Unsubscribing while a subscribe is still in flight cancels that attempt: the bridge tears down anything it created and stays unsubscribed. `realtimeStatus()` reports `{state, channels: [{channel, resourceType, ready}]}`. `waitForRealtimeApplied()` awaits pending applies and any scheduled pull (tests, shutdown flows).

## Server side

The server counterpart is `SyncResourceBase` (`src/sync/sync-resource-base.js`) plus the auto-mounted sync endpoints (`sync.api` configuration option) — see `docs/offline-sync.md`.
