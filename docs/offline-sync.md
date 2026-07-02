# Offline Sync Architecture

This document records the target architecture for Velocious local-first sync. It is an implementation plan and compatibility contract for building reusable offline sync in Velocious and then migrating downstream apps such as Printyourticket/ticket-app and AwesomeTasks onto the framework primitives.

## Goals

- Let frontend apps keep working for long periods with no backend connection.
- Reuse Velocious resource authorization and `permittedParams` instead of creating a parallel sync write path.
- Support shared resource files that run in both frontend and backend bundles.
- Let devices exchange mutations directly while offline without trusting peer database rows.
- Keep backend replay authoritative and auditable when connectivity returns.
- Support both generic model mutations and app-defined domain commands.

## Non-goals

- Do not make frontend JavaScript a trusted security boundary.
- Do not accept arbitrary `{resourceType, resourceId, data}` payloads as a privileged backend write API.
- Do not require every resource authorization rule to be expressible as declarative JSON. Velocious resources may use real JavaScript, database queries, nested attributes, and CanCan-style abilities.
- Do not force high-risk resources such as roles, billing settings, tokens, or security configuration to support offline writes.

## Main concepts

### Shared resources

Projects that need long-lived offline or peer-to-peer sync should define shared resource files that are bundled into both the frontend and backend. The shared resource contains frontend-safe business policy and validation code:

- model name and sync configuration
- portable `abilities` helpers where they can run against either local SQLite or backend DB models
- `permittedParams` / `offlinePermittedParams` logic, including nested attributes
- offline validation
- conflict strategy
- domain sync command schemas and handlers where they are portable

Backend and frontend resource wrappers should resolve behavior in this order:

1. environment-specific resource method
2. shared resource method
3. framework default

That fallback lets projects keep most resource behavior in one shared place while still adding backend-only hooks, frontend-only local runtime hooks, or compatibility behavior where needed.

Shared resource modules must be bundle-safe. They should not import backend-only model files directly, use raw database drivers, read secrets, access the filesystem, or rely on Node-only APIs. Shared resource queries should use Velocious' portable model/query API through the resource context.

### Resource context

The framework should inject a consistent context into shared resources:

- `currentUser()`
- `currentDevice()`
- `offlineGrant()`
- `model(name)` to resolve the environment's model registry
- `isFrontend()` / `isBackend()` / `isOffline()`
- `now()`

On the backend, `model(name)` resolves real database-backed model classes. On the frontend, it resolves local SQLite/frontend-local model classes. The same shared resource method can therefore query the local replica while offline and the authoritative database during backend replay.

Frontend decisions are provisional because local SQLite may be stale or incomplete. Backend decisions are authoritative unless a resource explicitly chooses a grant-time offline policy.

### Offline grants

A long-offline app cannot ask the backend for live permission checks. During bootstrap or a later refresh, the backend issues a signed offline grant that materializes what a user/device may do offline.

A grant should include at least:

- grant id
- user id
- device id
- issued/expiry timestamps
- policy version and policy hash
- resource operation metadata
- materialized scopes or context needed by shared resource policy code
- grant-time authorization policy

The grant is signed by the backend. Clients and peers can verify the signature offline. The grant does not make frontend code trusted; it gives honest clients and peers a portable proof that a backend-authorized user/device received specific offline authority.

Resources should be able to choose authorization policy per operation:

- current permission wins during replay
- grant-time permission wins during replay
- custom resource policy
- online-only / offline disabled

True long-term offline operation implies delayed revocation. The framework should make that explicit through grant expiry, resource opt-outs, and audit trails.

### Device certificates and mutation signatures

Every offline-capable device should have a key pair. The backend registers the device public key and signs a device certificate containing:

- device id
- user id
- public key
- issued/expiry timestamps

Offline mutations are signed by the originating device. Peer devices verify the device certificate, the offline grant, and the mutation signature before applying or forwarding a mutation.

The HTTP uploader may differ from the mutation actor. If Device B receives Device A's mutations peer-to-peer, Device B may later upload those signed mutations to the backend. Backend replay must build the resource context from the signed actor/grant, not blindly from the uploader's HTTP session.

### Mutation log

Frontend apps should persist an append-only local mutation log instead of only storing dirty model rows. Each mutation should include:

- client mutation id
- actor user id and actor device id
- model mutation or domain command name
- operation
- record id or client id
- attributes or command payload
- base version / base server sequence where applicable
- offline grant id
- policy hash
- occurred-at timestamp
- signature
- dependency ids for offline-created records
- local status

Useful statuses include:

- `pending`
- `appliedLocally`
- `peerReceivedUnapplied`
- `peerAppliedPendingServerConfirmation`
- `conflict`
- `rejected`
- `synced`

Local writes update SQLite optimistically after shared resource policy checks pass. Server replay later returns per-mutation results so the client can mark mutations as synced, rejected, or conflicted.

### Server replay

The backend sync receiver should treat sync as batched delayed resource commands, not as a separate privileged write path. Apps that already receive batches of sync envelopes can use [`SyncEnvelopeReplayService`](sync-envelope-replay-service.md) for the generic replay loop while keeping resource policy, token/device lookup, and domain handlers app-owned.

Replay pipeline:

1. Verify mutation envelope, device certificate, grant signature, expiry, and idempotency key.
2. Resolve the model/resource from the registered Velocious resource manifest.
3. Build actor context from the signed mutation actor and offline grant.
4. Resolve operation or domain command.
5. Run sync-specific hooks when present; otherwise fall back to normal resource abilities and `permittedParams`.
6. Reject unpermitted attributes and nested attributes as contract errors.
7. Apply create/update/destroy through the normal resource/model pipeline.
8. Persist the mutation result idempotently.
9. Append server-sequenced changes to the change feed.
10. Return a structured result for each mutation.

Result statuses should distinguish at least:

- `applied`
- `duplicate`
- `rejected`
- `conflict`
- `error`

### Change feed and snapshots

Accepted backend changes should be stored in an append-only server-sequenced feed. Clients pull with a stable cursor such as `serverSequence > lastSeenSequence`, not timestamp plus offset.

A change should include:

- server sequence
- model or command result type
- operation
- record id
- serialized payload
- actor user/device
- originating client mutation id when present
- scope data needed for subscribers
- server timestamp

If a client is too far behind for retained changes, the server returns `snapshot_required`. The client then refreshes a scoped snapshot and resumes from the snapshot's sequence.

### Peer-to-peer transfer

Devices should exchange signed mutation logs and proof material, not trusted database rows.

A peer export contains:

- signed mutations
- signed offline grants
- signed device certificates
- optional snapshot chunks and signed snapshot manifests when available

On import, the receiving device verifies:

1. backend signature on the offline grant
2. backend signature on the device certificate
3. device signature on the mutation
4. policy hash compatibility
5. grant scope and expiry
6. shared resource `permittedParams` / offline policy against local data where possible
7. duplicate mutation ids
8. local conflict strategy

If the receiver cannot verify because policy code or local related data is missing, it stores the mutation as `peerReceivedUnapplied` and may forward it later. If verification passes, it can apply the mutation locally as `peerAppliedPendingServerConfirmation`.

### Generic model mutations vs domain commands

Generic model sync is appropriate for normal CRUD-like resources such as tasks, comments, labels, and simple settings.

Domain-sensitive workflows should use sync commands instead of raw model attribute writes. Examples:

- ticket scanner `scanAttempt`
- task board `moveCard`
- ordering operations with conflict-prone row numbers
- operations that create several model changes from one user action

A sync command still uses offline grants, mutation signatures, idempotency, shared resource policy, and backend replay, but the resource owns the domain decision and the emitted model changes.

## Sequence: bootstrap

1. User signs in while online.
2. Frontend asks for sync bootstrap for a project, event, board, or other scope.
3. Backend evaluates resources, abilities, `permittedParams`, offline hooks, and materialized scopes for the actor/device.
4. Backend returns initial snapshot data, server sequence, shared policy hashes, device certificate, and signed offline grant.
5. Frontend stores snapshot data in local SQLite and persists the grant/device material.

## Sequence: offline write

1. User performs an action while offline.
2. Frontend resolves the shared resource and checks the signed grant, local scope, `permittedParams`, and local validation.
3. Frontend appends a signed mutation to the local log.
4. Frontend updates local SQLite optimistically.
5. UI shows the change as pending until backend confirmation.

## Sequence: peer import

1. Device A exports signed pending mutations and proof material.
2. Device B imports the bundle.
3. Device B verifies signatures, grants, policy hash, and local applicability.
4. Device B applies verifiable mutations provisionally or stores unverifiable mutations for forwarding.
5. Device B can later upload Device A's signed mutations to the backend.

## Sequence: backend replay and catch-up

1. A device uploads its own and/or peer-forwarded signed mutations.
2. Backend verifies signatures, idempotency, actor context, grants, abilities, and `permittedParams`.
3. Backend applies valid mutations or returns structured rejection/conflict results.
4. Backend appends server-sequenced change records for accepted changes.
5. Clients pull changes after their last sequence and converge on authoritative state.

## Ticket-app migration outline

1. Harden current ticket-app sync path while the framework is being built: remove unsafe auth bypasses, authorize every sync mutation, scope pending rows by actor/device/event, and add idempotency.
2. Move scanner read-side event/ticket/ticket-scan snapshots to Velocious snapshot/change-feed primitives.
3. Replace scanner `TicketScan` and `Ticket.whereaboutState` attribute sync with a `TicketScan.scanAttempt` domain command.
4. Add peer-transfer support for scanner devices using signed mutations and grants.
5. Remove old ad-hoc sync endpoints after supported app versions have migrated.

## AwesomeTasks proof outline

AwesomeTasks is a good proof target for generic resource sync:

- task create/update through model mutations
- comment create as append-only model mutation
- labels/assignments through model or command sync depending on conflict needs
- board move through a `TaskBoard.moveCard` domain command instead of raw `rowNumber` updates

The proof should validate that shared resources, offline grants, local mutation logs, peer forwarding, server replay, and server-sequenced changes are usable outside ticket-app.

## Open implementation decisions

- Exact signing algorithm and key rotation strategy.
- Whether offline grant persistence is framework-owned or app-owned with framework interfaces.
- The default conflict strategy for resources without an explicit strategy.
- How much snapshot integrity data is required for peer bootstrap in v1.
- Whether frontend-local resources are generated automatically from shared resources or configured explicitly per app.

## Implemented slice: declarative sync client

`SyncClient` implements the declarative client-side driver: query-declared sync scopes with per-scope cursors, pull paging/apply, declarative local queueing, and online-gated replay. See `docs/sync-client.md`.

## Implemented slice: local mutation log

Velocious has a client-side local mutation log for the first local-first/offline write path. It is intentionally small and append-only: frontend code records what the user tried to do, applies the allowed change optimistically to the in-memory model instance, and leaves server replay/conflict resolution to later sync pipeline steps.

### LocalMutationLog

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

### Offline frontend-model writes

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

### Current boundaries

This slice does not replay mutations to the backend, resolve conflicts, import peer logs, or persist frontend-model rows into app SQLite tables by itself. Those belong to the later server replay, change feed, conflict, P2P, and app integration tasks. The current contract is the durable local mutation log plus the optimistic frontend-model `save()`/`destroy()` queue path.
