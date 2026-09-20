# Sync coordinator

`SyncCoordinator` is the reusable application-lifecycle owner around a tenant-bound `SyncClient`. `SyncClient` continues to own durable mutation ordering, acknowledgement rebasing, scopes/cursors, remote apply, echo suppression, and realtime subscriptions. The coordinator owns when those primitives run: one replay → realtime-subscribe → pull cycle, observable status, bounded retry, connectivity/manual/realtime triggers, and deterministic teardown.

Import it from the public source path shipped by the package:

```js
import SyncCoordinator from "velocious/build/src/sync/sync-coordinator.js"
```

## Construction and application boundary

Build the `SyncClient` with the immutable tenant handle that owns the local replica, then give that client to one coordinator:

```js
const projectSync = SyncClient.fromConfiguration(configuration, {
  databaseIdentifier: "projectTenant",
  requestContext: {projectId, protocolVersion: 2},
  tenantHandle: projectReplica
})

const coordinator = new SyncCoordinator({
  syncClient: projectSync,
  prepare: async ({signal}) => {
    // App policy: keep the selected replica pinned while this lifecycle owns it.
    const releasePin = await acquireProjectReplicaPin({projectId, signal})

    // Framework primitive: declare the user scope without starting network work.
    await projectSync.activateUserScope()

    return releasePin
  },
  connectivity: {
    subscribe: (listener) => networkMonitor.subscribe(listener)
  },
  classifyError: (error) => classifySyncError(error),
  statusStore: projectSyncStatusStore
})

const unsubscribeStatus = coordinator.subscribe((status) => renderSyncStatus(status))

await coordinator.start()
// Render cached replica reads now. start() installs local ownership and schedules
// the initial network cycle; it does not await replay, websocket, or pull.
```

Application code still owns policy Velocious cannot infer:

- selecting and pinning the canonical user/project replica;
- declaring the scopes that lifecycle should serve (usually `activateUserScope()` in `prepare`);
- translating status codes into UI text;
- classifying transport/domain errors into safe `{code, message?, retryable}` metadata;
- providing a durable status store when last-success/failure status must survive restart;
- choosing when an explicit user conflict resolution is allowed.

Velocious owns the generic mechanics. Do not add an app-local replay lock, retry loop, cursor writer, reconnect pull, mutation coalescer, or second realtime apply path alongside this coordinator.

## Cycle and trigger ordering

Every online cycle uses this order:

1. replay durable local intent through `SyncClient.replayPending()`;
2. establish the derived realtime subscriptions;
3. pull every active scope from its stable stored cursor.

Mutation queueing and realtime readiness/resume events route back through the attached coordinator automatically. Calls to `trigger()` while a cycle is active never overlap it: they collapse into one queued rerun. Realtime apply itself remains serial inside `SyncRealtimeBridge`; own-origin pushes and server-originated local writes retain `SyncClient`'s existing echo suppression.

`start()` is idempotent. It attaches the client trigger, subscribes to connectivity, starts mutation tracking, runs `prepare`, and schedules the first cycle without awaiting that network work, so cached UI reads are never gated on network-only loading. `waitForCurrentRun()` exists for deterministic tests and controlled shutdown checks; product rendering should observe status instead.

`stop()` is also idempotent. It generation-fences late work, cancels retry timers, removes connectivity/client triggers, aborts and drains `SyncClient`, and then runs the teardown returned by `prepare`. A failed partial start uses the same cleanup ownership. A stopped or replaced generation cannot publish status after a later lifecycle starts.

## Observable status

`status()` returns the current deeply immutable snapshot. `subscribe(listener)` immediately supplies that snapshot and returns an unsubscribe function. The `state` values are:

- `stopped` — no lifecycle owns the client;
- `idle` — the last online cycle converged and no durable work remains;
- `pending` — durable intent remains queued;
- `syncing` — the single-flight cycle is running;
- `offline` — the connectivity gate is closed (cached reads remain usable);
- `backoff` — a classified transient failure has a scheduled retry;
- `failed` — automatic retry is not allowed/exhausted, or durable rejected intent exists;
- `conflicted` — one or more durable conflict records need an explicit decision.

Snapshots also expose `pendingCount`, `rejectedCount`, `lastSuccessAt`, `nextRetryAt`, safe failure metadata, and privacy-safe conflict diagnostics. `statusStore.save(status)` receives only this safe snapshot. The original `Error`, auth token, mutation attributes, authoritative model data, and rejection payload are never copied into coordinator status.

Full conflict payloads remain durable in `LocalMutationLog` for the app's explicit resolution screen. The coordinator diagnostic contains only stable resource/log/mutation identifiers plus base/local/server versions and the version-attribute name.

## Retry and connectivity

Automatic retry defaults to four total consecutive attempts with exponential delays from 1 second up to 30 seconds. Configure `{initialDelayMs, maxDelayMs, maxAttempts}` under `retry`. `classifyError(error)` decides whether a failure is retryable and must return a stable, safe code; it must not return secrets or raw server payloads.

The optional connectivity adapter is notification-only. `SyncClient.isOnline()` remains the authoritative check at the start of each cycle. Going offline cancels a retry timer and publishes `offline`; returning online resets the consecutive-attempt counter and triggers catch-up. `retry()` clears current backoff and requests a manual cycle through the same single-flight path. Retry never sleeps inside sync work.

Tests can inject `{setTimeout, clearTimeout}` through `scheduler` and a deterministic `now()` clock. Advance the fake scheduler explicitly; do not use elapsed-time sleeps.

## Conflict application and resolution

When a replay conflict includes `conflict.serverModel`, `SyncClient` applies that authoritative record through its existing tenant-bound remote applier before marking the local mutation `conflict`. That write uses normal tracking suppression, so it does not echo back into the queue. The rejected local intent and complete server result remain in `LocalMutationLog`.

Resolve it explicitly through the coordinator:

```js
await coordinator.resolveConflict({
  recordId: diagnostic.recordId,
  resourceType: diagnostic.resourceType,
  resolution: "keep-server" // or "retry-local"
})
```

`keep-server` acknowledges the preserved intent only after that user/application decision. `retry-local` rebases the mutation onto the conflict's authoritative `serverVersion`, returns it to pending, and replays through the coordinator. A missing version or non-conflict record fails loudly.

## Scope and non-goals

The coordinator is an in-process foreground application lifecycle. It does not provide P2P mutation transfer, an operating-system background sync service, UI components/translations, application telemetry, or replica eviction policy. Replica owners must still refuse to release/delete dirty, pinned, or in-use storage according to their application policy.
