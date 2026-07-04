# Declarative sync client

`SyncClient` (`src/sync/sync-client.js`) is the declarative client-side sync driver. Apps declare sync on their models and configure transport, auth, and connectivity once; Velocious derives the resource map and owns scope persistence, per-scope cursors, pull paging and apply, local queueing, and online-gated replay.

## Deriving the client from configuration (recommended)

Models opt in with `static sync`; `SyncClient.fromConfiguration(...)` (or the lazy `syncClient()` accessor) derives everything else from the app's Velocious configuration:

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

`fromConfiguration` derives per resource:

- **resources**: every registered model (`configuration.getModelClasses()`) declaring `static sync`; the resource key is the model name.
- **booleanAttributes**: attributes whose columns have boolean types.
- **localOnlyAttributes**: the primary key, `createdAt`/`updatedAt`, and sync bookkeeping columns (`lastSyncChangeAt`), merged with any `localOnlyAttributes` declared on the model.
- **tracked payloads**: the default queued data is the record's attributes minus local-only attributes, with booleans coerced and Date values serialized to ISO strings — no per-model payload builders.
- **syncType**: the `"upsert"` flag queues creates and updates as `"update"` rows (the server upserts by resource id) and destroys as `"delete"`; a function stays available for per-operation mapping.
- **syncModel**: the registered `Sync` model (override with `options.syncModel`).
- **transport/auth**: the framework owns the `/velocious/sync/changes` and `/velocious/sync/replay` POSTers over `sync.client.transport`; `authenticationToken`, `isOnline`, `onError`, and `batchSize` come from the same block.

Missing column metadata, a missing `Sync` model, a missing `sync.client` block, unknown declaration keys, and invalid transports all fail loudly with actionable errors.

Before this derivation existed, apps hand-wrote the whole resource map (~160 lines in the scanner app: modelClass wiring, boolean/local-only lists, ISO-date payload builders, syncType mappers, POSTers, auth plumbing). That entire footprint collapses to the `static sync` declarations plus the `sync.client` block above.

`syncClient(configuration = Configuration.current())` memoizes one client per configuration and registers it as the current sync client on first construction.

## Low-level configuration

The explicit resource map stays available as the low-level API when full control is needed:

```js
import SyncClient from "velocious/build/src/sync/sync-client.js"

const syncClient = new SyncClient({
  authenticationToken: () => getUser().getAuthenticationToken(),
  isOnline: async () => (await Network.getNetworkStateAsync()).isConnected !== false,
  postChanges: (payload) => ServerConnection.current().post("/velocious/sync/changes", payload),
  postReplay: (payload) => ServerConnection.current().post("/velocious/sync/replay", payload),
  syncModel: Sync,
  resources: {
    Ticket: {
      modelClass: Ticket,
      attributes: ({data}) => ({name: data.name}),
      findRecord: async ({data}) => await Ticket.findOrInitializeBy({id: data.id})
    },
    TicketScan: {
      modelClass: TicketScan,
      booleanAttributes: ["accepted", "rejected"],
      localOnlyAttributes: ["id", "createdAt", "updatedAt"],
      syncType: ({operation}) => operation === "create" ? "scanAttempt" : "update"
    }
  }
})

syncClient.setCurrent()
```

Invalid configuration fails loudly at construction time. See `src/sync/sync-client-types.js` for the full config typedefs.

## Declaring sync scopes from queries

```js
await syncClient.sync(Event.where({partnerId}))
// or, with a current sync client registered:
await Event.where({partnerId}).sync()
```

The query is serialized into a `{resourceType, conditions}` scope (only plain attribute equality conditions are supported — joins, orders, limits, raw SQL, and negations fail loudly), persisted in the framework-owned `velocious_sync_scopes` table (auto-created; process-local memory when no database is configured), and pulled immediately when online. `pull()` iterates every active scope with its own persisted cursor and sends the scope in each `postChanges` payload so the server can enforce access per scope. `unsync(query)` / `query.unsync()` deactivates a scope.

Devices migrating from a pre-scope cursor store can seed newly declared scopes through the `legacyCursor({scope})` config hook, avoiding a full re-pull.

## Automatic mutation tracking

Resources with `track` enabled queue sync rows automatically when their local models change — no app-side queue calls:

```js
resources: {
  TicketScan: {
    modelClass: TicketScan,
    track: true, // or {operations: ["update"]}
    syncType: ({operation}) => operation === "create" ? "scanAttempt" : "update",
    trackedData: ({record}) => ({...record.attributes(), deviceId: currentDeviceId()})
  }
}

await syncClient.start() // registers afterCreate/afterUpdate/afterDestroy callbacks
```

`start()` registers model lifecycle callbacks for every tracked resource (destroys queue `"delete"` sync rows); `stop()` unregisters them. Records written by pull-apply are excluded (echo suppression), so applying remote changes never queues them back to the server.

## Local changes and replay

```js
await syncClient.queue({resource: ticketScan, syncType: "scanAttempt"})
```

Explicit `queue()` stays available for command-style mutations whose payload carries more than the record's attributes.

`queue()` persists a pending row on the app's `syncModel` (stripping `localOnlyAttributes`, coercing `booleanAttributes`) and schedules an immediate background replay. Replays are single-flighted and online-gated; rows are marked successful only after the backend acknowledges them, so offline or rejected changes stay pending for the next attempt. Background failures go to the `onError` config hook (rethrown when none is configured). `waitForScheduledReplay()` awaits the last scheduled attempt (useful in tests and shutdown flows).

## Server side

The server counterpart is `SyncResourceBase` (`src/sync/sync-resource-base.js`) plus the auto-mounted sync endpoints (`sync.api` configuration option) — see `docs/offline-sync.md`.
