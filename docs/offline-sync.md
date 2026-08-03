# Offline and Shared-Resource Sync

This document is both the architecture decision and the developer guide for Velocious local-first sync. The [goals](#goals) and [main concepts](#main-concepts) explain the durable framework boundary; the [adoption guide](#adoption-guide) uses APIs present on the current Velocious source. It is also the migration checklist for replacing an app-owned `{type, id, data}` sync path with framework-owned resource routing, signed offline authority, peer transfer, conflict reporting, and server-sequenced catch-up.

The current implementation is deliberately composable rather than one all-in-one coordinator. Velocious owns shared-resource fallback, deterministic policy manifests, grants and device signatures, the row-oriented mutation log, peer mutation bundles, resource-routed replay, conflicts, and change-feed clients. An app still supplies persistent storage, device/grant custody, its actor/grant-scoped ability factory, feed scope hooks, and genuinely domain-specific commands. In particular, there is currently no global frontend resource registry and no `peer_received_unapplied` `LocalMutationLog` status; the guide calls out the small app-side wiring required at those boundaries.

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
- `permittedParams` for normal writes and flat `writableAttributes` for routed replay
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

Shared resources expose a consistent context API:

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

The implemented `LocalMutationLog` statuses are:

- `pending`
- `applied-locally`
- `peer-applied`
- `conflict`
- `rejected`
- `synced`

Apps that need to retain a peer mutation before framework import can keep a separate `peer_received_unapplied` quarantine label, but it is not accepted by `LocalMutationLog.updateStatus()`. Local writes may update SQLite optimistically after shared resource policy checks pass. Server replay later returns per-mutation results so the client can mark mutations as synced, rejected, or conflicted.

### Server replay

The backend sync receiver should treat sync as batched delayed resource commands, not as a separate privileged write path. Apps that already receive batches of sync envelopes can use [`SyncEnvelopeReplayService`](sync-envelope-replay-service.md) for the generic replay loop while keeping resource policy, token/device lookup, and domain handlers app-owned.

Replay pipeline:

1. Verify mutation envelope, device certificate, grant signature, expiry, and idempotency key.
2. Resolve the model/resource from the registered Velocious resource manifest.
3. Build actor context from the signed mutation actor and offline grant.
4. Resolve operation or domain command.
5. Run sync-specific hooks; apply the signed actor/grant ability and either the normal frontend-model `permittedParams` pipeline or routed replay's flat `writableAttributes` permit.
6. Reject unknown, read-only, or unpermitted attributes as contract errors.
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

A complete app transfer protocol needs:

- signed mutations
- signed offline grants
- signed device certificates (embedded in each `SignedSyncMutation`)
- optional snapshot chunks and signed snapshot manifests when available

The current `exportPeerMutationBundle` v1 format carries only signed mutations (with embedded device certificates); the app must transfer/store signed grants separately. `importPeerMutationBundle` verifies the certificate and mutation signatures plus duplicate ids, then stores accepted rows as `peer-applied`. Grant, current-policy, ability, and permitted-attribute checks happen during server replay.

The full receiving flow therefore verifies:

1. backend signature on the offline grant
2. backend signature on the device certificate
3. device signature on the mutation
4. policy hash compatibility
5. grant scope and expiry
6. shared resource `permittedParams` / offline policy against local data where possible
7. duplicate mutation ids
8. local conflict strategy

If the receiver cannot complete local application because proof or related data is missing, it may retain the untouched bundle entry under an app `peer_received_unapplied` quarantine label and forward it later. Once `importPeerMutationBundle` verifies it, the framework log status is `peer-applied`.

### Generic model mutations vs domain commands

Generic model sync is appropriate for normal CRUD-like resources such as tasks, comments, labels, and simple settings.

Domain-sensitive workflows should use sync commands instead of raw model attribute writes. Examples:

- ticket scanner `scanAttempt`
- task board `moveCard`
- ordering operations with conflict-prone row numbers
- operations that create several model changes from one user action

A sync command still uses offline grants, mutation signatures, idempotency, shared resource policy, and backend replay, but the resource owns the domain decision and the emitted model changes.

## Adoption guide

### Define one shared resource and two thin wrappers

Keep portable declarations and small domain hooks in a bundle-safe shared file. This example uses only real `FrontendModelBaseResource` static fields and portable helpers:

```js
// shared/resources/task.js
import FrontendModelBaseResource from "velocious/build/src/frontend-model-resource/base-resource.js"

export default class SharedTaskResource extends FrontendModelBaseResource {
  static attributes = ["id", "projectId", "title", "columnId", "position", "updatedAt"]
  static builtInCollectionCommands = ["index", "create"]
  static builtInMemberCommands = ["find", "update", "destroy"]
  static memberCommands = ["moveCard"]
  static writableAttributes = ["id", "projectId", "title"]

  static sync = {
    conflictStrategy: "optimisticVersion",
    operations: ["index", "find", "create", "update", "destroy", "moveCard"],
    policyVersion: "tasks-v1",
    metadata: {scope: "project"},
    policy: {
      grantScopeAttributes: ["projectId"],
      writableAttributes: ["projectId", "title"]
    }
  }

  permittedParams({action} = {}) {
    if (action === "create") return ["id", "projectId", "title"]

    return [
      "title",
      {commentsAttributes: ["id", "_destroy", "body"]}
    ]
  }

  async moveCard({id, columnId, position}) {
    const Task = this.model("Task")
    const task = await Task.findByOrFail({id})

    task.setColumnId(columnId)
    task.setPosition(position)
    await task.save()

    return {id: task.id()}
  }
}
```

`static writableAttributes` is the flat permit used by `SyncEnvelopeReplayService` routed CRUD. It includes `id` because routed creates validate the client-generated primary key against this permit before omitting it from the assigned attributes. `permittedParams(arg)` is the normal frontend-model write permit and supports nested attributes. The two declarations are intentionally separate: the routed replay service does not accept nested permit objects, and the built-in offline `FrontendModelBase.save()` queue currently rejects nested attributes and attachments. Represent an atomic offline nested workflow as a declared domain command instead of smuggling a nested payload through generic CRUD.

The backend wrapper binds the real database model and may add backend-only ability or domain behavior:

```js
// backend/src/resources/task.js
import FrontendModelBaseResource from "velocious/build/src/frontend-model-resource/base-resource.js"
import SharedTaskResource from "../../../shared/resources/task.js"
import Task from "../models/task.js"

export default class TaskResource extends FrontendModelBaseResource {
  static ModelClass = Task
  static SharedResource = SharedTaskResource
}
```

Keep normal online abilities in the app's existing ability resources. For signed replay, the `abilityFactory` shown below must build an ability from the verified actor and grant scopes; do not derive it from mutation payload params.

The frontend/local wrapper binds the SQLite model and receives the portable context explicitly. Velocious does not currently install these wrappers into a process-wide frontend resource registry, so keep one small app factory:

```js
// frontend/src/resources/task.js
import FrontendModelBaseResource from "velocious/build/src/frontend-model-resource/base-resource.js"
import SharedTaskResource from "../../../shared/resources/task.js"
import Task from "../models/task.js"

export default class LocalTaskResource extends FrontendModelBaseResource {
  static ModelClass = Task
  static SharedResource = SharedTaskResource
}

export function localTaskResource({currentDevice, currentUser, offlineGrant}) {
  return new LocalTaskResource({
    context: {
      currentDevice,
      currentUser,
      modelRegistry: {Task},
      offlineGrant,
      resourceRuntime: "offline"
    },
    modelName: "Task",
    params: {}
  })
}
```

The context may expose `modelRegistry` as a name-to-class object or as `{model(name)}`. Shared code can call `currentUser()`, `currentDevice()`, `offlineGrant()`, `now()`, `resourceRuntime()`, `isBackend()`, `isFrontend()`, `isOffline()`, and `model(name)`. `SignedSyncEnvelopeReplayService` supplies `currentUser`, `offlineGrant`, `offlineGrantScopes`, and `resourceRuntime: "offline"`, but it does not add a model registry to that context. If signed shared hooks call `model(name)`, use the small replay subclass below to expose the backend configuration's model map.

Fallback is deterministic:

1. An environment wrapper's own or inherited static value/method.
2. `static SharedResource`'s value/method.
3. The `FrontendModelBaseResource` framework default.

An environment method override wins completely. Call the relevant `super` method only when the wrapper deliberately wants to compose the shared/default behavior.

### Register resources and configure sync once

Register every replayable type in the backend project's `frontendModels` map. Then use one `sync` block on `Configuration`:

```js
const configuration = new Configuration({
  backendProjects: [{
    path: backendPath,
    frontendModels: {
      Sync: AppSyncResource,
      Task: TaskResource
    }
  }],
  sync: {
    api: {resourceClass: AppSyncResource},
    changeFeedRetentionSize: 10_000,
    deviceCertificateBackendPublicKey,
    offlineGrantSigningKeys: [{
      current: true,
      id: "offline-grant-2026-08",
      secret: appSecrets.offlineGrantSigningSecret
    }],
    offlineGrantTtlMs: 24 * 60 * 60 * 1000
  }
})
```

`AppSyncResource` subclasses `SyncResourceBase`, binds the change-feed model with `static ModelClass`, and implements only `authorizeChanges({params, scope})` and `scopeChangesQuery({params, query, scope})`. The default replay class is `SyncEnvelopeReplayService`. For peer-forwarded mutations whose shared hooks use `model(name)`, expose the configuration on signed replay context and declare that class as `static ReplayServiceClass`:

```js
import SignedSyncEnvelopeReplayService from "velocious/build/src/sync/signed-sync-envelope-replay-service.js"
import SyncResourceBase from "velocious/build/src/sync/sync-resource-base.js"

class AppSignedSyncEnvelopeReplayService extends SignedSyncEnvelopeReplayService {
  async buildReplayContext(args) {
    return {
      ...await super.buildReplayContext(args),
      configuration: this.configuration
    }
  }
}

class AppSyncResource extends SyncResourceBase {
  static ModelClass = Sync
  static ReplayServiceClass = AppSignedSyncEnvelopeReplayService

  // authorizeChanges(...) and scopeChangesQuery(...) stay app-specific.
}
```

Return the signed service's app-owned arguments from `replayServiceArgs()`:

```js
replayServiceArgs() {
  const sync = this.controllerInstance().getConfiguration().getSyncConfiguration()

  if (!sync.deviceCertificateBackendPublicKey) throw new Error("Missing sync device certificate public key")

  return {
    actorLookup: async (userId) => await User.findBy({id: userId}),
    abilityFactory: ({actor, grant}) => buildOfflineAbility({actor, grant}),
    backendPublicKey: sync.deviceCertificateBackendPublicKey,
    conflictStrategy: {strategy: "optimisticVersion", versionAttribute: "updatedAt"},
    offlineGrantSigningKeys: sync.offlineGrantSigningKeys,
    syncModel: Sync
  }
}
```

Load `appSecrets.offlineGrantSigningSecret` from the app's established secret store and keep it backend-only. Rotate by adding verification keys and marking exactly one key `current`; do not put a secret, token, private key, function, `Date`, or other nondeterministic value in resource `sync.metadata` or `sync.policy`.

### Bootstrap the manifest and offline grant

`POST /frontend-models/sync/bootstrap` with `{deviceId, scopes}`. The normal frontend-model request authentication establishes the current user. The response contains:

```js
{
  status: "success",
  syncManifest: {
    Task: {
      conflictStrategy: "optimisticVersion",
      enabled: true,
      operations: [/* sorted operation names */],
      policyHash: "sha256-...",
      policyVersion: "tasks-v1"
    }
  },
  offlineGrant: {
    algorithm: "HS256",
    grant: {/* grantId, userId, deviceId, resources, scopes, issuedAt, expiresAt */},
    keyId: "offline-grant-2026-08",
    signature: "hmac-sha256-..."
  }
}
```

Velocious computes each `policyHash` from normalized enabled state, operations, model name, conflict strategy, `policyVersion`, frontend-safe `metadata`, and hash-only `policy`. Persist the complete signed grant and the manifest used for the local decision. A changed policy or version intentionally invalidates mutations and grants issued under the old hash; refresh bootstrap instead of rewriting signed mutations.

Grant `scopes` are app material supplied at bootstrap, not proof by themselves. Derive the authoritative replay ability from the verified actor and grant and fail closed when the actor or scope cannot be resolved. Grant expiry bounds delayed revocation; shorter TTLs reduce the revocation window but require more online refreshes.

### Persist and sign the local mutation log

Back `LocalMutationLog` with one SQLite/IndexedDB row per record and implement `appendRecord`, `deleteRecords`, `nextSequence`, `record`, `records`, and `updateRecord`:

```js
import LocalMutationLog from "velocious/build/src/sync/local-mutation-log.js"

const mutationLog = new LocalMutationLog({
  storage: sqliteMutationLogStorage,
  storageKey: "awesome-tasks.sync.mutations"
})
```

For the built-in frontend-model optimistic queue, pass the grant id in the shape the current transport consumes:

```js
import FrontendModelBase from "velocious/build/src/frontend-models/base.js"

FrontendModelBase.configureTransport({
  offlineSync: {
    actorDeviceId: currentDevice.id,
    actorUserId: currentUser.id,
    enabled: true,
    mutationLog,
    offlineGrant: {id: signedOfflineGrant.grant.grantId}
  }
})
```

New/persisted `save()` calls queue `create`/`update`; `destroy()` queues `destroy`. The generated model's `resourceConfig().sync` must enable the operation. The built-in queue appends an unsigned mutation with `baseVersion: null`; `exportPeerMutationBundle` signs it when exporting. If an app needs a meaningful base version, explicit dependencies, or signing at mutation time, build the documented `SyncMutation`, call `createSignedMutation(...)`, and append both values with `mutationLog.append({mutation, signedMutation})`.

Current log statuses are exactly `pending`, `applied-locally`, `peer-applied`, `conflict`, `rejected`, and `synced`. Use `pendingRecords()` for replay work, `updateStatus(...)` for reconciliation, and `compact(...)` only after retaining dependency-referenced records.

### Export, import, forward, and replay P2P bundles

```js
import {
  exportPeerMutationBundle,
  importPeerMutationBundle
} from "velocious/build/src/sync/peer-mutation-bundle.js"

const bundle = await exportPeerMutationBundle({
  deviceCertificate,
  devicePrivateKey,
  mutationLog
})

const imported = await importPeerMutationBundle({
  backendPublicKey,
  bundle,
  mutationLog
})
```

Export includes `pending`, `applied-locally`, and `conflict` records by default. Import verifies the backend-signed device certificate and device mutation signature, skips duplicate actor/user/device mutation identities, retains the original `signedMutation`, and marks accepted rows `peer-applied`. It returns separate `imported`, `skipped`, and `rejected` arrays.

The v1 peer bundle contains signed mutations and their embedded device certificates, but not signed offline grants. The app's transfer protocol must carry/store the originating signed grant keyed by `mutation.offlineGrantId`. On reconnect, forward the unchanged `record.signedMutation` with that grant to `SignedSyncEnvelopeReplayService` only when it was explicitly built for that service: creates carry `id` in `attributes`, while updates, destroys, and domain commands carry their target `id` in `payload`. The built-in `save()`/`destroy()` queue instead keeps the primary key in `attributes`; replay those rows through `POST /frontend-models/sync/replay`, or construct the signed-service shape before signing and peer export. Never reshape or re-sign a peer's signed mutation with the forwarding device. The service verifies the original certificate, mutation, grant, current manifest, actor/device/grant identities, policy hashes, and the actor/grant-scoped ability before resource routing. Submit separate signed replay requests for each actor user, actor device, and offline grant; a mixed request fails as `mixed-signed-replay-batch`.

`importPeerMutationBundle` does not apply the resource policy or local model change. If an app needs a quarantine state named `peer_received_unapplied` because related data, the grant, or local policy is unavailable, store that state beside (not as) the `LocalMutationLog` row and retain the original bundle entry for later verification/forwarding. Do not pass `peer_received_unapplied` to `updateStatus()`; it is not a framework status on the current API. A verified framework import is `peer-applied`.

### Replay authorization, permits, commands, and results

There are two current server entry paths:

- `POST /frontend-models/sync/replay` verifies the signed certificate, signed grant, current manifest, operations, and hashes, then dispatches CRUD through the normal frontend-model command pipeline. That path reuses the request's current ability and `permittedParams`, including strict rejection of unknown flat or nested keys. Use it only when the authenticated request actor is the mutation actor.
- `SignedSyncEnvelopeReplayService` is the peer-forwarding path. It derives an ability from the signed actor/grant with `abilityFactory`, routes through the registered resource, scopes lookup/create membership with that ability, and filters generic CRUD with flat `static writableAttributes`. Declared collection/member operations dispatch to the resource method with `mutation.payload`; member commands receive the envelope resource id as `args.id`.

Examples of normal resource permits:

```js
permittedParams() {
  return ["projectId", "title"]
}
```

```js
permittedParams() {
  return [
    "title",
    {commentsAttributes: ["id", "_destroy", "body"]}
  ]
}
```

For nested writes, the model must also declare `acceptsNestedAttributesFor(...)`; including `"_destroy"` in the permit is not sufficient without `{allowDestroy: true}` on that relationship. See [`nested-attributes.md`](nested-attributes.md).

Use generic CRUD for independent record state. Use a declared resource command for operations that need a lock, transaction, ordering invariant, multi-record change, or domain result. A command remains untrusted input: validate its payload, authorize the record(s), perform the transaction, and return a small result object. `TaskBoardSyncResource#moveCard` in the dummy app is the representative implementation.

The built-in replay endpoint returns one `results[]` entry per mutation. Feed each entry to the exported result mapper:

```js
import {applySyncReplayResultToLocalMutationLog} from "velocious/build/src/sync/conflict-strategy.js"

await applySyncReplayResultToLocalMutationLog({mutationLog, record, result})
```

It maps applied/duplicate/success to `synced`, conflicts to `conflict`, and error/rejected or a failed command/change-feed append to `rejected`. `SignedSyncEnvelopeReplayService` instead returns `syncs[]` with `syncState: "successful" | "failed" | "conflict"`; update the matching row explicitly and retain the complete result in `syncResult`.

### Conflict strategies

Resource `static sync.conflictStrategy` accepts `optimisticVersion`, `serverWins`, `lastWriterWins`, `fieldThreeWay`, or `appendOnly` as policy metadata. `resolveSyncConflict(...)` implements those strategies when the caller can provide the required base/server snapshots.

Routed backend replay has less information and supports only `optimisticVersion` and `serverWins`. Enable it explicitly with `conflictStrategy: {strategy, versionAttribute}` on the replay service; the static resource declaration alone does not turn the check on. A stale update returns `syncState: "conflict"` with `affectedFields`, `baseVersion`, `localMutation`, `serverModel`, `serverVersion`, `suggestedResolution`, and `versionAttribute`. It is not applied, persisted, or broadcast. Commands, deletes, `applySync` overrides, and legacy `applyHandlers` own their own conflict semantics.

### Portable query boundary

Shared hooks must stay within the query intersection supported by backend records and the app's local/frontend model: model lookup (`find`, `findBy`, `findByOrFail`), descriptor-based `where`/`joins`, `sort`/`order`, `group`, `distinct`, `pluck`, `count`, `limit`, `offset`, `page`, `perPage`, and `toArray`/`load` as supported by that model. Do not use raw SQL strings, driver/table objects, backend-only transactions, filesystem/Node APIs, secrets, or non-literal dynamic imports in shared modules. Relationship joins and conditions must be object descriptors; frontend models reject raw SQL join fragments. When a workflow needs backend-only locking or database features, keep only the command declaration shared and override/implement its handler in the backend wrapper.

### Security boundary

- The frontend, its SQLite rows, shared JavaScript policy, manifest cache, and UI authorization checks are untrusted. They improve offline behavior; only signature verification plus server resource/ability enforcement authorizes a write.
- Offline authority is deliberately revocable only after a grant expires or reconnects to a changed current policy. Choose `offlineGrantTtlMs` for the resource risk and audit mutations by original actor/device, not uploader.
- The built-in bootstrap endpoint signs the `scopes` object supplied in the request. Expose it only behind app authorization that validates/materializes those scopes, or wrap bootstrap in an app endpoint that derives scopes server-side. Never let an arbitrary client expand its own signed scope.
- A peer may store and forward another device's mutation. The backend must use the signed actor/grant and `abilityFactory`, never the forwarding device's HTTP identity. Retain the original signature and idempotency key.
- Keep roles, billing settings, credentials/tokens, signing configuration, destructive administration, and other high-risk resources online-only: omit sync operations or declare `static sync = false`. Do not issue offline grants for them.
- Grant HMAC secrets and device/backend private keys never belong in `metadata`, `policy`, generated resources, peer bundles, logs, or frontend configuration. The device's own private key belongs in platform secure storage.

### Troubleshooting

**Policy hash mismatch.** Compare the mutation `policyHash`, `signedOfflineGrant.grant.resources[model].policyHash`, and current bootstrap `syncManifest[model].policyHash`. Also confirm the operation is enabled in both manifest and grant. A resource `policyVersion`, operation, model name, conflict strategy, metadata, or hash-only policy change can move the hash. Refresh bootstrap and create new mutations; do not edit and re-sign an old user's intent just to force it through.

**Rejected mutation.** Inspect the per-entry `status`, `response`, `reason`, and `errorMessage`/`message`. Common causes are an expired/mismatched certificate or grant, missing actor lookup, `offline-grant-denied`, `signed-replay-ability-missing`, `access-denied`, `sync-unknown-attribute`, model validation, or a missing command handler. Keep client-safe rejections isolated to their row; unexpected thrown errors remain framework failures and must be reported rather than converted to a rejection.

**Conflict.** Persist the complete conflict payload on the log row. `affectedFields` identifies the locally written fields; `serverModel`/`serverVersion` are authoritative. Apply the resource's UX (`manual` or `keep_server`), then either mark the mutation terminal or create a new mutation from the new server base. Do not retry the same stale signed mutation indefinitely.

**`peer_received_unapplied`.** This is an app quarantine label, not a current `LocalMutationLog` status. Verify that the peer bundle format is v1, the embedded certificate and mutation signature validate against the configured backend public key, the certificate is unexpired, and the originating signed grant is present in the app grant store. Then refresh missing local scope/policy data and call `importPeerMutationBundle` again. If local application must remain deferred, preserve the original bundle entry for forwarding; once framework import succeeds its log status is `peer-applied`.

## Sequence: bootstrap and initial catch-up

1. User signs in while online.
2. App registers or refreshes the device certificate through its device-identity flow.
3. Frontend posts `{deviceId, scopes}` to `/frontend-models/sync/bootstrap` behind app authorization that validates those scopes.
4. Backend returns the current sync manifest and signed offline grant.
5. Frontend persists the complete grant/device material, then obtains the scoped snapshot/change feed or declares `SyncClient` scopes and pulls into local storage.

## Sequence: offline write

1. User performs an action while offline.
2. App optionally resolves the local shared wrapper for provisional grant, permit, and domain validation; this is never authoritative security.
3. Frontend appends a mutation (and optionally its signature) to `LocalMutationLog`.
4. Frontend updates local SQLite optimistically.
5. UI shows the change as pending until backend confirmation.

## Sequence: peer import

1. Device A calls `exportPeerMutationBundle`; the app transfers the bundle and corresponding signed grants.
2. Device B calls `importPeerMutationBundle`, which verifies certificate/mutation signatures and deduplicates entries.
3. Device B stores verified entries as `peer-applied`; app quarantine retains entries that cannot yet be imported/applied.
4. Device B may apply verified mutations provisionally through its local shared wrapper.
5. Device B later uploads Device A's original `signedMutation` and signed grant without re-signing either.

## Sequence: backend replay and catch-up

1. A device uploads its own and/or peer-forwarded signed mutations in separate actor-user/device/grant batches.
2. Backend verifies signatures, idempotency, actor context, grants, current policy, actor/grant-scoped abilities, and the selected permit path.
3. Backend applies valid mutations or returns structured rejection/conflict results.
4. Backend appends server-sequenced change records for accepted changes.
5. Client maps each replay result onto its local log row, pulls after its last sequence, and converges on authoritative state.

## Migration checklist: ad hoc app sync to framework sync

1. **Inventory and classify.** List every ad hoc resource, operation, queue status, snapshot, cursor, peer payload, retry rule, and conflict rule. Classify each write as generic CRUD, domain command, or online-only high risk.
2. **Fence the legacy path.** Before migration, require authentication/authorization per mutation, actor/device/scope partitioning, an idempotency key, payload allowlists, bounded batches, and audit/error reporting. Stop adding new generic mechanics there.
3. **Create shared declarations.** Move frontend-safe attributes, commands, flat `writableAttributes`, `permittedParams`, sync operations, policy metadata/version, and portable domain checks into one shared resource per type.
4. **Add thin environment wrappers.** Bind backend and local SQLite model classes with `static SharedResource`. Keep backend database/lock integrations and frontend storage/UI code out of the shared module.
5. **Register the backend manifest.** Add wrappers to `backendProjects[].frontendModels`; verify the generated `syncManifest`, operation list, and deterministic policy hashes. Keep high-risk resources absent/disabled.
6. **Install authoritative abilities.** Build replay abilities from the verified signed actor and offline grant scopes. Add cross-scope denial tests, missing-actor/grant failure tests, and peer-uploader/original-actor tests.
7. **Issue bounded grants and device certificates.** Choose expiry/rotation, secure key custody, server-derived scopes, bootstrap refresh behavior, and audit fields. Roll out read-only bootstrap before offline writes.
8. **Adopt the row mutation log.** Migrate pending rows into `LocalMutationLog` shape without losing original ids/order/dependencies. Persist one row per mutation and map legacy statuses to the six framework statuses plus any separate quarantine table.
9. **Move one low-risk resource end to end.** Queue/sign, export/import, replay through the registered resource and abilities/permit, map results, and catch up from a server-sequenced feed. Keep the legacy endpoint as a version-gated fallback during rollout.
10. **Extract domain commands.** Replace multi-row or invariant-sensitive raw updates with declared commands; add transaction/lock handling in the backend wrapper and return explicit domain results/change-feed entries.
11. **Select and test conflict behavior.** Choose a base version and supported replay strategy per CRUD resource; exercise two-device, stale-policy, rejected-attribute, expired-grant, duplicate, and concurrent replay cases.
12. **Add peer forwarding.** Transfer signed grants beside v1 bundles, retain original signed envelopes, quarantine unverifiable entries, and prove a different uploader cannot change the original authority.
13. **Cut over reads and writes.** Move snapshots/pulls/realtime to `SyncClient` and framework change feeds, compare convergence/metrics with legacy sync, then disable legacy writes for migrated client versions.
14. **Remove the old machinery.** After the supported-client window closes, delete legacy endpoints, serializers, dirty-row queues, bypasses, retry workers, and compatibility status mappings. Keep audit retention and a rollback/runbook for already-issued grants.

## Reference implementation and tests

The architecture decision is the [goals](#goals), [non-goals](#non-goals), and [main concepts](#main-concepts) in this document. The focused proof and tests are:

- [`awesome-tasks-offline-sync-proof.md`](awesome-tasks-offline-sync-proof.md) — framework-owned Task/Comment CRUD, `TaskBoard.moveCard`, signed offline replay, and actor/grant scope proof.
- [`frontend-model-resource/base-resource-spec.js`](../spec/frontend-model-resource/base-resource-spec.js) — shared static/method fallback and portable resource context/model registry.
- [`frontend-models/resource-definition-spec.js`](../spec/frontend-models/resource-definition-spec.js) — deterministic sync policy normalization, hashes, and manifest.
- [`controller/frontend-model-sync-bootstrap-spec.js`](../spec/controller/frontend-model-sync-bootstrap-spec.js) and [`controller/frontend-model-sync-replay-spec.js`](../spec/controller/frontend-model-sync-replay-spec.js) — signed grants, manifest enforcement, normal ability/`permittedParams` replay, and result/change-feed behavior.
- [`sync/local-mutation-log-spec.js`](../spec/sync/local-mutation-log-spec.js) and [`sync/peer-mutation-bundle-spec.js`](../spec/sync/peer-mutation-bundle-spec.js) — row log, exact statuses, signatures, deduplication, and peer imports.
- [`sync/awesome-tasks-offline-peer-sync-end-to-end-spec.js`](../spec/sync/awesome-tasks-offline-peer-sync-end-to-end-spec.js) — two-device forwarding, unauthorized attributes, policy mismatches, conflicts, and convergence.
- [`sync/awesome-tasks-signed-scope-authorization-spec.js`](../spec/sync/awesome-tasks-signed-scope-authorization-spec.js) — signed actor/grant ability isolation and fail-closed routing.
- [`sync/sync-envelope-replay-service-resource-routed-spec.js`](../spec/sync/sync-envelope-replay-service-resource-routed-spec.js) — registered resource routing, commands, abilities, flat permits, and safe failures.

## Current integration boundaries

- App storage owns offline grant persistence, secure device private-key custody, and the row storage adapter.
- Frontend/local shared wrappers are explicitly constructed; Velocious does not yet register or generate them.
- Peer bundle v1 does not carry offline grants or snapshot integrity material and does not apply a local resource mutation.
- `peer_received_unapplied` quarantine is app-owned; `LocalMutationLog` accepts only its six documented statuses.
- The built-in frontend-model queue writes `baseVersion: null`; version-aware conflict replay requires an explicitly built mutation until tracking supplies a base version.
- Static resource conflict policy and replay enforcement are separate; routed backend enforcement supports only `optimisticVersion` and `serverWins`.

## Implemented slice: declarative sync client

`SyncClient` implements the declarative client-side driver: query-declared sync scopes with per-scope cursors, pull paging/apply, declarative local queueing, and online-gated replay. See `docs/sync-client.md`.

## Implemented slice: auto-mounted server sync API

Servers enable the sync endpoints through configuration instead of route files:

```js
import SyncResource from "../resources/sync-resource.js"

const configuration = new Configuration({
  // ...
  sync: {
    api: {resourceClass: SyncResource}, // mountPath defaults to "/velocious/sync"
    offlineGrantSigningKeys: []
  }
})
```

During server boot Velocious registers `POST <mountPath>/changes` and `POST <mountPath>/replay` for the configured resource class (`SyncApiController.mountFromConfiguration`; the manual `route.mount(SyncApiController, ...)` path keeps working). Invalid `sync.api` values fail at configuration time.

The resource class subclasses `SyncResourceBase` (`velocious/build/src/sync/sync-resource-base.js`), which owns the changes/replay orchestration — optional client scope parsing (`{resourceType, conditions}` request param), change-feed paging through `SyncModelChangeFeedService`, and replay delegation/response shaping. Apps only declare:

```js
class SyncResource extends SyncResourceBase {
  static ModelClass = Sync

  async authorizeChanges({params, scope}) { /* throw unless the caller may read */ }
  scopeChangesQuery({params, query, scope}) { /* query.where({...}) visibility scoping */ }
  replayServiceClass() { return AppSyncReplayService }
  replayServiceArgs() { return {} } // optional constructor args
}
```

Unimplemented hooks fail loudly. Replay services extend `SyncEnvelopeReplayService` — see [`sync-envelope-replay-service.md`](sync-envelope-replay-service.md), including its model-backed `findExistingReplaySync`/`persistReplayMutation` defaults.

Each `/changes` page additively carries `total` — the scope's pending change count from the request cursor to the resolved snapshot bound. `SyncModelChangeFeedService` computes it with a COUNT over the same cursor-filtered query the page read uses (no extra materialized rows), so a client can render a "synced of total" progress bar; older clients ignore the field and older servers that omit it fall back to `0`. See the pull-progress section of [`sync-client.md`](sync-client.md).

## Implemented slice: server sequence allocation

`ServerSequenceAllocator` (`velocious/build/src/sync/server-sequence-allocator.js`) owns monotonically increasing server sync sequences. Every `next()` inserts a row into an AUTO_INCREMENT id table through the driver API and reads the allocated id from the insert statement itself (`OUTPUT INSERTED`/`RETURNING`, like the record create path), so sequences stay unique and increasing across processes sharing the database — MSSQL's `SCOPE_IDENTITY()` only sees inserts from the same batch, so a separate last-insert-id read is not an option there. Drivers without insert-returning support fall back to the connection-scoped last-insert-id read. Parallel `next()` calls are serialized per database+table across all allocator instances in the process.

The backing `velocious_server_sequences` table (`id` auto-increment primary key + `created_at`) is auto-created on first use, like the sync scope store. Because the mixin's beforeCreate allocation runs inside the record save transaction, that DDL can be rolled back with a failed save on transactional-DDL databases; the allocator only caches readiness when the table was not created inside an active transaction and re-verifies (and re-creates) the table on the next allocation otherwise. Without a configured database the allocator falls back to a process-local counter. Apps with an existing sequence table point the allocator at it — for a bare id-only table pass an empty insert payload:

```js
import ServerSequenceAllocator, {withServerSequence} from "velocious/build/src/sync/server-sequence-allocator.js"

// Framework-owned table (auto-created):
const allocator = new ServerSequenceAllocator({configuration})

// Existing bare AUTO_INCREMENT table (for example ticket-server's `sync_server_sequences`):
const appAllocator = new ServerSequenceAllocator({configuration, insertData: {}, tableName: "sync_server_sequences"})
```

`configuration` is optional and defaults to the current configuration, resolved lazily per allocation, so allocators can be constructed at module load time inside model files.

`withServerSequence(ModelClass, {allocator, column = "serverSequence"})` wires the sequencing contract onto a sync model: it registers a `beforeCreate` lifecycle callback assigning the next sequence when the record has none, and defines `advance<Column>()` (when the model does not already define one) so the model satisfies the replay service's `advanceServerSequence` contract. The sequence is always written through the generated typed setter (`set<Column>`), and the model must expose the generated `set<Column>`/`has<Column>` accessors:

```js
class Sync extends SyncBase {
}

withServerSequence(Sync, {allocator: new ServerSequenceAllocator({insertData: {}, tableName: "sync_server_sequences"})})
```

## Implemented slice: sync resource quick search and writable-attribute permit lists

`SyncResourceBase` inherits the full frontend-model index assembly (`records()`/`count()` through the controller's `frontendModelIndexQuery`: ability-authorized query, preload, joins, where, distinct, searches, sort and pagination) from `FrontendModelBaseResource`, so sync resources do not override `records`/`count`. Pagination policy plugs into the existing `applyFrontendModelIndexPagination({controller, pagination, query})` hook.

On top of that:

- `SyncResourceBase` adds `static quickSearchColumns = ["resource_id", "resource_type", "sync_type"]` — an index search on the pseudo-column `quickSearch` (with the `like` operator and a string value; anything else is rejected with the client-safe `sync-invalid-quick-search` error) expands to an OR of LIKE conditions over the declared root-table columns, using driver quoting. Blank values are treated as handled without filtering. Resources without declared columns keep the controller's default search behavior.
- `FrontendModelBaseResource` (so every frontend-model resource, sync or not) owns `static writableAttributes = ["title", "startsAt"]` — a plain permit list of camelCase attribute names. When declared, the default `permittedParams()` returns it, and the routed sync replay filters mutation payloads to it (accepting each attribute's camelCase name plus the model's actual column name; unknown keys fail loudly). The list resolves through the shared resource like the other static resource config. Value casting and validation are the record layer's job — booleans, datetime strings and numbers cast on write, and `validates(...)` model validations (presence, length, format, uniqueness) reject bad values with translated messages through the `velocious.errors.messages.*` validation-message layer.

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
    offlineGrant: {id: signedGrant.grant.grantId},
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

`LocalMutationLog` itself does not replay mutations, resolve conflicts, import peers, or persist frontend-model rows into app SQLite tables. Compose it with `exportPeerMutationBundle`/`importPeerMutationBundle`, a replay endpoint/service, `applySyncReplayResultToLocalMutationLog` or explicit status mapping, and the app's local record storage. The built-in `save()`/`destroy()` queue also records `baseVersion: null` and rejects nested/attachment payloads, so version-aware or domain-atomic writes need an explicitly built mutation/command.

## Implemented slice: resource-routed replay

`SyncEnvelopeReplayService` routes replay mutations through the app's registered frontend-model resource classes: applying a mutation is just applying new data to a model and saving it. The service accepts `configuration` (mutation `resourceType` resolves through the `frontendModels` registry via `resolveFrontendModelResourceClass`, honoring `static modelName` overrides), `resourceTypeOverrides` (resource classes or string registry aliases), plus `ability`/`abilityContext`/`locals` for authorization scoping. `SyncResourceBase#buildReplayService` plumbs all of these in under `replayServiceArgs()` (app args win) and `replayServiceClass()` defaults to `SyncEnvelopeReplayService`.

Routed resources declare behavior through four hooks on `FrontendModelBaseResource`: `authorizeSyncMutation` (mutation-level gate), `findSyncRecord` (ability-scoped `accessibleFor` primary-key lookup through the resource's normalized ability actions), `applySync` (full escape hatch replacing the default flow — custom delete semantics, ignore-missing-record flows and staleness overrides live here) and `afterSyncApply` (domain tail whose extras reach `persistExtraAttributes` and broadcasts), plus `syncAuthorizationFailureReason` for pinned per-action denial reasons. Upsert payloads are filtered to the resource's `writableAttributes` permit list and applied with `assign` + `save`; creates use the client-generated primary key with a save-then-check membership check (denied creates are destroyed again before any sync row is persisted or broadcast), and a record existing outside the resource's lookup scope fails as an authorization denial instead of colliding on the primary key.

Client-safe apply failures — model validation (surfaced with the translated `ValidationError` message as `reason: "validation-error"`), authorization denials, unpermitted attributes and unknown resource types — fail only their own sync with `{id, syncState: "failed", reason, message}` while the batch continues; unexpected errors keep failing the request. The `applyHandlers`/`SyncReplayUpsertApplier` path is deprecated but keeps precedence over routing for released adopters. See [`sync-envelope-replay-service.md`](sync-envelope-replay-service.md) for the full flow.

## Implemented slice: server publish-by-default and the framework sync channel

`SyncPublisher` (`src/sync/sync-publisher.js`) is the server mirror of the client's track-by-default mutation tracking: server-side writes to synced models publish to the sync change feed and broadcast the standard sync envelope on the framework sync channel automatically, so a change made on the server (an importer, a partner saving a setting through frontend models) reaches every device without app code declaring channels or calling manual upsert/broadcast helpers.

Server models declare what to publish through the `publish` key of the shared `static sync` declaration (the client ignores the key):

```js
class Ticket extends ApplicationRecord {
  static sync = {publish: true} // default payload: the record's attributes (Dates as ISO strings)
}

class Setting extends ApplicationRecord {
  static sync = {publish: {serialize: (setting) => ({id: setting.id(), pin: setting.pin()})}}
}
```

`SyncPublisher.startFromConfiguration(configuration)` runs at server boot (`application.js`, beside the auto-mounted sync endpoints) and no-ops when no registered model declares publish. Publishing is on for models declaring it — creates and updates publish by default, destroys publish as `"delete"` rows when opted in with `operations: ["create", "update", "destroy"]`, and `publish: false` opts a model out explicitly. The sync/change model defaults to the registered `"Sync"` model.

### Scope partition

The sync model declares which attribute(s) partition the app's sync feed — Velocious has no built-in partition name:

```js
class Sync extends ApplicationRecord {
  static syncScopeAttributes = ["eventId"] // or ["accountId"], ["projectId"], ...
}
```

For every published change, each declared scope attribute reads the record's attribute of the same name when the model has one, else the record's own id (scope-root models — e.g. the record a scope condition points at). `publish: {scopeAttributes: {accountId: "ownerId"}}` overrides the record attribute per model by name. The resolved values are persisted onto the sync row's matching columns (so the app's `scopeChangesQuery` can serve them) and broadcast as the framework sync channel's scoping params. The change feed's default row serialization emits every declared scope attribute under its own name; a sync model declaring no scope attributes keeps the deprecated pre-declaration wire, which emits `eventId`.

### The framework sync channel

After the sync row is upserted post-commit, the publisher broadcasts the standard sync envelope on the framework-owned `velocious-sync` channel (`src/sync/sync-channel-name.js`) with the resolved scope values as broadcast params:

```js
{echoOrigin: null, syncs: [{data, resourceId, resourceType, syncType}]}
```

The channel itself (`src/sync/sync-websocket-channel.js`) is registered automatically at server boot when `sync.api` is configured. Subscribe params mirror a declared pull scope — `{resourceType, conditions}` plus the client-injected `authenticationToken` — and subscribe-time authorization delegates to the app sync resource's existing `authorizeChanges({params, scope})`, so the app hooks in through the authorization it already declared; there is no channel class, resolver, or broadcast wiring to write. Broadcast routing delivers to a subscription when the published resource type equals the subscription scope's `resourceType` and the broadcast's scoping params satisfy every scope condition it was authorized for (string comparison; array conditions match by membership; broadcasts without a resource type and conditions the scoping params do not carry never match, so a subscription cannot receive changes outside its authorized scope). Because routing is per resource type, declare one pull scope per synced resource type that should receive realtime pushes.

The pre-framework-channel declaration forms keep working but are deprecated: `eventId` (attribute-name string or resolver function, pinned to a fixed `event_id` column and `eventId` scoping param) and `broadcasts` (declarative app-channel broadcasts, delivered after the framework broadcast — keep them only for legacy channels old app versions still subscribe).

#### User scope (server-enumerated) and per-delivery access

A subscription with **empty conditions** is a *user scope* — "everything my ability can see". Its `authorizeChanges` runs with an empty-conditions scope (the app decides whether user scopes are allowed), and because it declares no conditions it matches every broadcast of its resource type. Broadcast routing therefore re-checks record access **per delivery** for user scopes: each published change is filtered through the sync resource's `changeDeliverable({params, scope, sync})`, whose default reuses the app's `scopeChangesQuery` — applying it to the change-feed model (which for an empty-conditions scope falls back to ability scoping) and checking whether the published change's feed row is visible in that scope. The `sync` argument is the **complete broadcast sync entry** — immutable sync-row `id`, actor-specific metadata, and every other publisher field — with only `resourceId`/`resourceType` normalized to strings (on a copy; the published entry is never mutated), so an override can authorize two entries for the same resource identity independently by their exact-row identity. Scoped subscriptions (with explicit conditions) already routed through `matches()`, so they deliver unchanged with no extra query. Two subscribers with disjoint access each receive only their own changes over one connection (precedent: the frontend-models channel's per-delivery access check). The per-delivery re-check runs in the broadcast's ambient tenant/connection context; the feed's own scope columns and the app's ability scoping bound what each subscriber sees.

On the client, `syncClient().subscribeUserScope()` declares an empty-conditions scope for every pullable resource type, subscribes their `velocious-sync` channels, and pulls (the empty-conditions pull scope makes `scopeChangesQuery` fall back to ability scoping with per-scope cursor continuity). `unsubscribeUserScope()` deactivates the scopes and closes the subscriptions without disconnecting the shared connection.

Mechanics mirror the client tracker: the payload is snapshotted through `serialize(record)` at mutation-callback time (later drift on the record cannot change what was committed), persisting and broadcasting defer through the model connection's `afterCommit` hook (rolled-back mutations never publish), and post-commit failures are reported loudly (`options.onError` or the publisher logger) without poisoning the driver's afterCommit chain. The sync row is upserted through the same shared primitive as the replay service's model-backed persistence (`src/sync/sync-change-fanout.js`): one server-origin row per resource identity, keyed by a null actor column (`authentication_token_id` by default — a server-origin change has no device to echo back to), reassigned and re-sequenced through `advanceServerSequence()` so feed cursors pick the change up again. Framework and declared broadcasts deliver through the same injected broadcaster shape the replay service uses (defaulting to the configuration's channel broadcast).

Replayed device mutations never double-publish: the framework's routed replay apply marks every record it writes through `markServerApply(record)` for the duration of the replay-owned write — the replay keeps owning its own persistence, stale-guard, and broadcasts, while later server-side writes to the same record instance publish normally again. Code applying already-synced data outside the replay suppresses publishing the same way through the public API (`src/sync/sync-publish-suppression.js`):

```js
import {markServerApply, withoutPublishing} from "velocious/build/src/sync/sync-publish-suppression.js"

await withoutPublishing(async () => {
  // every publish callback in here is skipped, across awaits; nested calls stack
  await importDeviceOriginRows()
})

// record-precise form (what the routed replay apply uses internally):
const release = markServerApply(record)
try {
  record.assign(attributesFromDevice)
  await record.save()
} finally {
  release()
}
```

`withoutPublishing` suppression is process-wide while its callback runs, so mutations from concurrently running requests are also skipped for that window — prefer `markServerApply(record)` when writes from other flows can interleave.
