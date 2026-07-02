# Declarative sync client

`SyncClient` (`src/sync/sync-client.js`) is the declarative client-side sync driver. Apps configure resources, transport, auth, and connectivity once; Velocious owns scope persistence, per-scope cursors, pull paging and apply, local queueing, and online-gated replay.

## Configuration

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

## Local changes and replay

```js
await syncClient.queue({resource: ticketScan, syncType: "scanAttempt"})
```

`queue()` persists a pending row on the app's `syncModel` (stripping `localOnlyAttributes`, coercing `booleanAttributes`) and schedules an immediate background replay. Replays are single-flighted and online-gated; rows are marked successful only after the backend acknowledges them, so offline or rejected changes stay pending for the next attempt. Background failures go to the `onError` config hook (rethrown when none is configured). `waitForScheduledReplay()` awaits the last scheduled attempt (useful in tests and shutdown flows).

## Server side

The server counterpart is `SyncResourceBase` (`src/sync/sync-resource-base.js`) plus the auto-mounted sync endpoints (`sync.api` configuration option) — see `docs/offline-sync.md`.
