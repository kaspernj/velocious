# Offline sync mutation log

Velocious has a client-side local mutation log for the first local-first/offline write path. It is intentionally small and append-only: frontend code records what the user tried to do, applies the allowed change optimistically to the in-memory model instance, and leaves server replay/conflict resolution to later sync pipeline steps.

## LocalMutationLog

`LocalMutationLog` lives in `velocious/build/src/sync/local-mutation-log.js`.

```js
import LocalMutationLog from "velocious/build/src/sync/local-mutation-log.js"

const mutationLog = new LocalMutationLog({
  storage: sqliteMutationLogStorage,
  storageKey: "my-app.sync.mutations"
})
```

The storage adapter is intentionally **row-oriented**. Do not store the entire log as one JSON blob: native devices have SQLite available and small devices should not have to parse/stringify a growing mutation history for every append.

The storage adapter must expose:

- `appendRecord(storageKey, record)`
- `deleteRecords(storageKey, ids)`
- `nextSequence(storageKey)`
- `record(storageKey, id)`
- `records(storageKey, options)`
- `updateRecord(storageKey, record)`

Methods may be synchronous or async. On native/Expo, back this with SQLite using one row per mutation and indexes on `storageKey`, `status`, and `sequence`. On web, use IndexedDB or another row/key-per-record store rather than `localStorage` as one growing blob. Writes are serialized per `storageKey` so concurrent `append()` calls do not drop mutations or reuse the same sequence number.

Each appended record contains:

- `id`: local log record id.
- `sequence`: monotonically increasing local replay order.
- `status`: `pending`, `applied-locally`, `peer-applied`, `conflict`, `rejected`, or `synced`.
- `mutation`: the device mutation payload with actor user/device, grant id, policy hash, base version, model, operation, attributes/payload, and occurred timestamp.
- `dependencies`: optional create/temp-id dependencies that must replay first.
- `createdAt` / `updatedAt`.
- optional `syncResult` for backend replay metadata.

Use `pendingRecords()` to get records that still need reconciliation; storage adapters can service this through a status index rather than loading terminal history. Use `updateStatus(...)` after a replay, conflict, rejection, or successful sync. Use `compact(...)` after successful replay/sync to delete old terminal records while preserving pending/conflict records and records referenced by pending dependencies.

## Offline frontend-model writes

Frontend models can queue offline mutations by configuring transport-level offline sync:

```js
FrontendModelBase.configureTransport({
  offlineSync: {
    enabled: true,
    mutationLog,
    actorUserId: currentUser.id,
    actorDeviceId: currentDevice.id,
    offlineGrant: signedGrant.grant,
    clientMutationId: () => crypto.randomUUID(),
    now: () => new Date()
  }
})
```

A frontend model only queues locally when its generated `resourceConfig().sync` is enabled and the operation is listed in `sync.operations`.

Supported first-slice operations:

- `save()` on a new record queues `create`.
- `save()` on a persisted record queues `update`.
- `destroy()` queues `destroy`.

When a new record has no primary key yet, Velocious assigns the client mutation id as the temporary primary key and includes it in the mutation attributes. This gives later replay logic a stable id for create dependencies and temporary-id mapping.

For persisted records, offline `update` mutations include the primary key alongside changed attributes so replay and conflict handling can identify the target row even though normal online updates carry the id outside `attributes`.

Nested attributes and attachment payloads are not replayable in this first slice. If an offline `save()` includes either, Velocious rejects the offline save before queueing a mutation and leaves the nested/attachment pending state intact so the caller can retry online or with a later sync implementation.

If the local sync policy does not list the operation, the write is rejected locally and no mutation is queued.

## Current boundaries

This slice does not replay mutations to the backend, resolve conflicts, import peer logs, or persist frontend-model rows into app SQLite tables by itself. Those belong to the later server replay, change feed, conflict, P2P, and app integration tasks. The current contract is the durable local mutation log plus the optimistic frontend-model `save()`/`destroy()` queue path.
