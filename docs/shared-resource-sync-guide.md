# Shared-resource sync developer guide

This guide is the implementation and migration companion to the [offline sync architecture](offline-sync.md). It describes APIs that exist in the current Velocious tree and calls out the seams that are not yet automatic. Use it to adopt local/offline and peer-forwarded sync without copying a downstream app's generic sync machinery.

## Choose the current path deliberately

Velocious currently has two complementary, but not interchangeable, sync paths:

| Need | Current framework path | Important boundary |
| --- | --- | --- |
| Local database writes, durable pending rows, query-declared scopes, pull cursors, replay, and realtime under a live login | [`SyncClient`](sync-client.md), `SyncResourceBase`, an app `Sync` model, and `SyncPublisher` | Uses `sync.client.authenticationToken` and `/velocious/sync`; it does not sign its queued rows or export them to peers. |
| Long-offline proof and peer forwarding | `LocalMutationLog`, offline grants, device certificates, signed mutations, peer bundles, and `SignedSyncEnvelopeReplayService` | The primitives exist, but no current client class orchestrates grant refresh, signing, peer import, signed replay, and snapshot catch-up as one workflow. |
| Grant-scoped server-sequence snapshot/catch-up | `/frontend-models/sync/bootstrap`, `/frontend-models/sync/replay`, `/frontend-models/sync/changes`, and `/frontend-models/sync/snapshot` | This feed uses `ServerChangeFeedStore`, not the app `Sync` model or `SyncClient` cursor format. The replay endpoint uses the request's current ability. |

Do not send a cursor from one path to another or maintain two authoritative pending logs for the same write. A project can roll the paths out in stages, but must designate one owner for each resource and operation.

The architecture document still contains target-language such as peer verification of offline grants and `peerReceivedUnapplied`. The current implementation boundaries are listed under [Peer export, import, and forwarding](#peer-export-import-and-forwarding); target behavior is not an available API merely because it appears in the architecture record.

The minimal app surface is one shared recipe plus thin model-binding wrappers; local-model `static sync` declarations and one `sync.client` block for live-session sync; a `SyncResourceBase` subclass with `authorizeChanges` and `scopeChangesQuery`; and, only for signed/P2P use, a row-storage adapter, authorized device/grant enrollment, and a grant-scoped `abilityFactory`. App code still owns domain commands and genuine authorization decisions. Velocious owns generic resource discovery, queueing, signing formats, peer deduplication, replay routing, cursors, feed paging, and realtime delivery.

## 1. Define one shared resource recipe

Put frontend-safe policy in a module that both environments can bundle. Adjust only the app import paths in this copy-pasteable example:

```js
// shared/resources/task-resource.js
import FrontendModelBaseResource from "velocious/build/src/frontend-model-resource/base-resource.js"

export default class SharedTaskResource extends FrontendModelBaseResource {
  static modelName = "Task"

  static attributes = [
    "id",
    "name",
    "isDone",
    {name: "projectId", selectedByDefault: false},
    "updatedAt"
  ]

  static builtInCollectionCommands = ["index"]
  static builtInMemberCommands = ["find", "update"]

  // Routed SyncEnvelopeReplayService CRUD uses this flat list.
  static writableAttributes = ["id", "isDone", "name", "projectId"]

  // This becomes deterministic manifest metadata. `policy` is hashed but is
  // not exposed in generated frontend config.
  static sync = {
    conflictStrategy: "optimisticVersion",
    metadata: {scope: "project"},
    operations: ["index", "find", "create", "update"],
    policy: {
      grantScopeAttributes: ["projectId"],
      writableAttributes: ["isDone", "name", "projectId"]
    },
    policyVersion: "task-v1"
  }

  /** @returns {string[]} - Direct-write permit. */
  permittedParams() {
    return ["isDone", "name", "projectId"]
  }
}
```

The manifest's `policyHash` is derived during resource normalization from deterministic inputs including the model name, enabled state, conflict strategy, operations, `policyVersion`, `metadata`, and `policy`; it is not a field to hard-code. Bump `policyVersion` when an offline policy change should invalidate old grants and mutations.

### Backend wrapper

The backend wrapper binds the recipe to the authoritative model and can narrow any shared default:

```js
// backend/src/resources/task-resource.js
import FrontendModelBaseResource from "velocious/build/src/frontend-model-resource/base-resource.js"
import SharedTaskResource from "../../../shared/resources/task-resource.js"
import Task from "../models/task.js"

export default class TaskResource extends FrontendModelBaseResource {
  static ModelClass = Task
  static SharedResource = SharedTaskResource

  // Optional environment override. If omitted, the shared permit runs.
  permittedParams(arg) {
    const permitted = super.permittedParams(arg)

    return arg?.action === "update" ? permitted : permitted.filter((name) => name !== "isDone")
  }
}
```

Register `TaskResource` in the backend project's `frontendModels` map. Do not override `static resourceConfig()`; resource normalization requires declarative static fields.

### Frontend/local wrapper

The local wrapper binds the same recipe to the SQLite-backed model and supplies the portable resource context. This wrapper is useful for provisional local policy or validation code; it is not an authorization boundary and is not auto-created by the frontend-model generator.

```js
// app/src/resources/local-task-resource.js
import FrontendModelBaseResource from "velocious/build/src/frontend-model-resource/base-resource.js"
import SharedTaskResource from "../../../shared/resources/task-resource.js"
import LocalComment from "../models/comment.js"
import LocalTask from "../models/task.js"

export default class LocalTaskResource extends FrontendModelBaseResource {
  static ModelClass = LocalTask
  static SharedResource = SharedTaskResource
}

export function localTaskResource({currentDevice, currentUser, offlineGrant}) {
  return new LocalTaskResource({
    context: {
      currentDevice,
      currentUser,
      modelRegistry: {Comment: LocalComment, Task: LocalTask},
      offlineGrant,
      resourceRuntime: "offline"
    },
    modelName: "Task",
    params: {}
  })
}
```

Shared code resolves model classes through `this.model("Task")`; it must not import a backend model. Context helpers available to a shared recipe are `currentUser()`, `currentDevice()`, `offlineGrant()`, `now()`, `resourceRuntime()`, `isBackend()`, `isFrontend()`, and `isOffline()`.

### Exact fallback order

Static configuration and instance behavior resolve as follows:

1. value or method declared by the environment wrapper, including an inherited environment value;
2. value or overridden method on `static SharedResource`;
3. the `FrontendModelBaseResource` framework default.

An explicit environment static value, including `null`, wins. Default methods such as `permittedParams`, normalization/mutation hooks, `runMutationTransaction`, `beforeAction`, and `abilities` call the shared override only when the environment class did not override them. Custom commands, computed attribute methods, and virtual setters are resolved with `resourceMethod(...)`, environment first and shared second.

### Portable query boundary

Shared policy may use model/query operations present in both runtimes, resolved through `this.model(...)`. Prefer plain `find`, `findBy`, `where({...})`, relationship descriptors, and `toArray()`. The frontend query surface is narrower than the backend surface: do not use raw SQL, a query driver/table object, Node-only imports, filesystem access, secrets, or backend globals in shared files.

Sync scope queries are narrower still. `syncClient().sync(Model.where(...))` accepts only plain attribute equality conditions whose values are `null`, a string, number, boolean, or arrays of those scalars. It rejects raw SQL, negation, joins, orders, limits, offsets, groups, conflicting repeated conditions, and nested object values. A sync scope is a portable delivery/authorization descriptor, not a general data query.

## 2. Declare flat and nested write policy

Velocious has two real permit APIs with different replay coverage.

### Flat permits for routed replay

`SyncEnvelopeReplayService` resource routing requires `static writableAttributes`. It accepts camel-case attribute names and their real database column names, rejects every unknown key with `sync-unknown-attribute`, and always takes record identity from the envelope's `resourceId` rather than a payload `id`. Include the model primary key when routed creates carry that client-generated key in `data`: replay validates it against this permit before omitting it from the assigned attributes.

```js
static writableAttributes = ["id", "isDone", "name", "projectId"]
```

Routed replay does not call a request-aware `permittedParams(arg)` and does not support nested routed payloads. Use resource commands for domain-shaped or multi-record offline work.

### Flat and nested `permittedParams`

Normal frontend-model create/update and the built-in `/frontend-models/sync/replay` CRUD path run through the resource write pipeline and its `permittedParams(arg)`:

```js
permittedParams(arg) {
  const attributes = arg?.action === "create"
    ? ["name", "projectId"]
    : ["name", "isDone"]

  return attributes
}
```

Nested attributes use the Rails-style flat array supported by the actual parser:

```js
permittedParams() {
  return [
    "name",
    {commentsAttributes: ["id", "_destroy", "body"]},
    {subtasksAttributes: [
      "id",
      "_destroy",
      "name",
      {commentsAttributes: ["id", "_destroy", "body"]}
    ]}
  ]
}
```

The model must also declare `acceptsNestedAttributesFor(...)`; `_destroy` additionally requires `allowDestroy: true` on the model and `"_destroy"` in the permit. Unknown and read-only inputs are errors, not silently ignored. See [Nested Attributes](nested-attributes.md).

Current frontend-model offline queueing rejects nested attributes and attachments before logging. The nested example is valid for online writes and manually signed replay through the built-in frontend-model endpoint, not for `LocalMutationLog`'s automatic frontend-model offline-save slice or routed signed replay.

## 3. Pick a durable local log

### Declarative `SyncClient` log

For live-session sync, register a local `Sync` model and declare `static sync` on local models. `SyncClient` persists pending rows through that model, tracks create/update after commit by default, schedules online-gated replay, stores per-scope cursors, and suppresses echoes while applying pull/realtime data.

```js
class Task extends ApplicationRecord {
  static sync = true
}

class TaskBoard extends ApplicationRecord {
  static sync = {track: false}
}
```

Configure only app-owned boundaries:

```js
new Configuration({
  // ...
  sync: {
    client: {
      authenticationToken: () => currentSessionToken(),
      isOnline: () => networkIsOnline(),
      onError: (error) => reportSyncError(error),
      transport: frontendModelTransport,
      websocketClient
    }
  }
})
```

Then start once and declare scopes:

```js
import {syncClient} from "velocious/build/src/sync/sync-client.js"

await syncClient().start()
await syncClient().sync(Task.where({projectId}))
await syncClient().subscribeRealtime()
```

Do not rebuild the derived resource map, payload normalization, endpoint posters, cursor store, replay loop, or realtime channel in app code. See [Declarative sync client](sync-client.md).

### Signed/P2P mutation log

`LocalMutationLog` is the signed/P2P primitive. Its storage adapter is deliberately row-oriented:

```js
import LocalMutationLog from "velocious/build/src/sync/local-mutation-log.js"

const mutationLog = new LocalMutationLog({
  storage: sqliteMutationLogStorage,
  storageKey: "my-app.task-mutations"
})
```

The adapter implements `appendRecord`, `deleteRecords`, `nextSequence`, `record`, `records`, and `updateRecord`. Use a SQLite row per mutation on native clients, indexed by storage key, status, and sequence. Do not serialize the entire history into one `localStorage` JSON blob.

Current statuses accepted by `updateStatus(...)` are `pending`, `applied-locally`, `peer-applied`, `conflict`, `rejected`, and `synced`. `pendingRecords()` returns the first three. Preserve dependency rows until all pending/conflict records that reference them are resolved; `compact(...)` does this when pruning terminal rows.

The optional `FrontendModelBase.configureTransport({offlineSync: ...})` queue path writes this log and optimistically updates the in-memory frontend-model record when generated `resourceConfig().sync.operations` permits the operation. It does not persist that model row into an app SQLite table, sign the mutation, replay it, or import peers. A native local-model + `SyncClient` deployment and this frontend-model queue are distinct choices, not two halves of one automatic client.

## 4. Bootstrap grants and sign mutations

Configure backend-only offline-grant keys and the public key used to verify backend-issued device certificates:

```js
new Configuration({
  // ...
  sync: {
    deviceCertificateBackendPublicKey,
    offlineGrantSigningKeys: [
      {current: true, id: "offline-grant-2026-08", secret: appSecrets.offlineGrantSigningSecret}
    ],
    offlineGrantTtlMs: 24 * 60 * 60 * 1000
  }
})
```

Load `appSecrets.offlineGrantSigningSecret` from the app's established secret store. Never send an offline-grant signing secret or backend device-certificate private key to a client. Rotate grant keys by keeping old verification keys while one key is `current` for issuance.

With a normal frontend-model ability/current user, `POST /frontend-models/sync/bootstrap` with `{deviceId, scopes}` returns `{offlineGrant, syncManifest, status: "success"}`. The grant contains the user/device ids, expiry, materialized scopes, and current normalized resource entries. The current endpoint signs the submitted `scopes`; it does not independently prove that the user belongs to those scopes. Use it only behind app authorization that validates every requested scope, or issue the grant from an app-owned enrollment endpoint that performs the membership check and then calls `createOfflineGrantFromBootstrap(...)`. The bootstrap endpoint does not create a device keypair or certificate; scope authorization, device enrollment, and secure private-key storage remain app-owned security boundaries.

Use the framework signing helpers rather than inventing canonical JSON or signature formats:

```js
import {
  createSignedMutation,
  generateSyncSigningKeyPair
} from "velocious/build/src/sync/device-identity.js"

const deviceKeys = await generateSyncSigningKeyPair()

const mutation = {
  actorDeviceId: deviceCertificate.certificate.actorDeviceId,
  actorUserId: deviceCertificate.certificate.actorUserId,
  attributes: {name: "Write the guide"},
  baseVersion: task.updatedAt().toISOString(),
  clientMutationId: crypto.randomUUID(),
  model: "Task",
  occurredAt: new Date().toISOString(),
  offlineGrantId: signedOfflineGrant.grant.grantId,
  operation: "update",
  payload: {id: String(task.id())},
  policyHash: syncManifest.Task.policyHash
}

const signedMutation = await createSignedMutation({
  deviceCertificate,
  devicePrivateKey: deviceKeys.privateKey,
  mutation
})

await mutationLog.append({mutation, signedMutation})
```

The backend issues `deviceCertificate` with `createDeviceCertificate(...)` using its private key after registering the device public key. `createSignedMutation(...)` verifies that mutation actor/device ids match the certificate before signing. `mutationIdempotencyKey(...)` derives `actorUserId:actorDeviceId:clientMutationId`; never generate a new `clientMutationId` when retrying the same user action.

## 5. Peer export, import, and forwarding

Export signed pending records in local sequence order:

```js
import {
  exportPeerMutationBundle,
  importPeerMutationBundle
} from "velocious/build/src/sync/peer-mutation-bundle.js"

const bundle = await exportPeerMutationBundle({
  deviceCertificate,
  devicePrivateKey: deviceKeys.privateKey,
  mutationLog
})

const result = await importPeerMutationBundle({
  backendPublicKey: deviceCertificateBackendPublicKey,
  bundle,
  mutationLog: receivingMutationLog
})
```

The importer verifies the backend-signed device certificate and the originating device's mutation signature, rejects invalid entries independently, and skips an existing actor/device/client-mutation idempotency key. Imported rows retain `signedMutation` and receive local status `peer-applied`.

Current import does **not** carry or verify the offline grant, compare its policy hash, run shared-resource policy, or mutate the receiving device's local domain model. Despite the status name, `peer-applied` means the signed row is pending reconciliation in `LocalMutationLog`; any provisional domain apply is still explicit app behavior. A rejected signature is not appended.

When forwarding, send the retained original `signedMutation` plus the original actor's `signedOfflineGrant` only when the mutation was explicitly built for `SignedSyncEnvelopeReplayService`: creates carry `id` in `attributes`, while updates, deletes, and domain commands carry their target `id` in `payload`. The built-in `save()`/`destroy()` queue instead keeps the primary key in `attributes`; replay those rows through `/frontend-models/sync/replay`, or construct the signed-service shape before signing and peer export. Do not reshape or re-sign a peer mutation with the receiving device. `exportPeerMutationBundle(...)` does not automatically re-export imported rows: imports have status `peer-applied`, while the exporter accepts only `pending`, `applied-locally`, and `conflict`. Automatic multi-hop re-export is therefore unsupported. An application that needs another peer hop must explicitly transition or copy the record into an exportable, app-owned forwarding path while preserving the untouched original signed envelope, certificate provenance, and grant. `SignedSyncEnvelopeReplayService` derives authority from that original signer/grant rather than the uploader.

The architecture term `peerReceivedUnapplied` (sometimes rendered `peer_received_unapplied` by apps) is not a valid current `LocalMutationLog` status. If local data or policy is insufficient to apply a verified mutation, keep it in an explicitly app-owned quarantine/forwarding state or leave the existing app path in place; do not pass that string to `updateStatus(...)` or claim that Velocious imported it. Framework-owned unverifiable-bundle quarantine and offline grant exchange/verification are not implemented yet.

## 6. Replay through abilities and resource policy

### Live-session replay

`SyncResourceBase` mounts `/changes` and `/replay` when configured as `sync.api.resourceClass`. The resource supplies only app authorization/scoping and replay construction:

```js
import SyncResourceBase from "velocious/build/src/sync/sync-resource-base.js"
import AuthenticationToken from "../models/authentication-token.js"
import Sync from "../models/sync.js"

export default class SyncResource extends SyncResourceBase {
  static ModelClass = Sync

  async authorizeChanges({scope}) {
    if (!scope) throw this.writableAttributeError("A sync scope is required.", {code: "sync-scope-required"})
  }

  scopeChangesQuery({query, scope}) {
    if (scope?.conditions.project_id !== undefined) {
      query.where({project_id: scope.conditions.project_id})
    } else {
      query.where("1=0")
    }
  }

  replayServiceArgs() {
    return {
      authenticationTokenModel: AuthenticationToken,
      syncModel: Sync
    }
  }
}
```

Mount it through configuration; `mountPath` defaults to `/velocious/sync`:

```js
new Configuration({
  // ...
  sync: {
    api: {resourceClass: SyncResource},
    client: {
      authenticationToken: () => currentSessionToken(),
      transport: frontendModelTransport
    }
  }
})
```

The default `SyncEnvelopeReplayService` routes by `resourceType` through the registered backend frontend-model resource. It calls `authorizeSyncMutation`, performs ability-scoped record lookup with `findSyncRecord`, applies `static writableAttributes`, saves/validates, checks created-record ability membership, and calls `afterSyncApply`. Unknown resources and attributes fail only their envelope with a client-safe result; unexpected errors still fail the request.

### Signed, peer-forwarded replay

Use `SignedSyncEnvelopeReplayService` when the uploader may differ from the original actor. Configure an `abilityFactory` that derives every rule from the verified actor and grant scopes:

```js
import Ability from "velocious/build/src/authorization/ability.js"
import AuthorizationBaseResource from "velocious/build/src/authorization/base-resource.js"
import SignedSyncEnvelopeReplayService from "velocious/build/src/sync/signed-sync-envelope-replay-service.js"
import Task from "../models/task.js"

class OfflineTaskAbilityResource extends AuthorizationBaseResource {
  static ModelClass = Task

  abilities() {
    const projectId = this.getContext().offlineGrantScopes?.projectId

    this.can(["create", "read", "update"], projectId === undefined ? "1=0" : {projectId})
  }
}

const abilityFactory = ({actor, grant}) => new Ability({
  context: {
    currentUser: actor,
    offlineGrant: grant,
    offlineGrantScopes: grant.scopes,
    resourceRuntime: "offline"
  },
  resources: [OfflineTaskAbilityResource]
})

class SignedSyncResource extends SyncResource {
  static ReplayServiceClass = SignedSyncEnvelopeReplayService

  replayServiceArgs() {
    const configuration = this.controllerInstance().getConfiguration()

    return {
      abilityFactory,
      backendPublicKey: configuration.getSyncConfiguration().deviceCertificateBackendPublicKey,
      conflictStrategy: {
        strategy: "optimisticVersion",
        versionAttribute: "updatedAt"
      },
      offlineGrantSigningKeys: configuration.getSyncConfiguration().offlineGrantSigningKeys,
      syncModel: Sync
    }
  }
}
```

Mount `SignedSyncResource` as `sync.api.resourceClass`. `SyncResourceBase` already injects `configuration`; do not write a parallel resource registry or dispatch loop. A signed batch sent to that resource has the exact shape:

```js
await frontendModelTransport.post("/velocious/sync/replay", {
  signedMutations: [{signedMutation, signedOfflineGrant}]
})
```

All entries in one `SignedSyncEnvelopeReplayService` batch must share the actor, device, and grant. Split batches at that boundary when forwarding records from several origin devices.

Signed replay verifies certificate/signature, grant signature/expiry, actor-device-grant equality, the current manifest, grant operations, and both policy hashes. It fails closed without an `abilityFactory` result. Its routed CRUD path uses `static writableAttributes`, as described above. The built-in `/frontend-models/sync/replay` endpoint instead runs normal CRUD through the current request ability and `permittedParams`; do not use that live request ability as proof of the original actor when accepting a peer-forwarded upload.

Delete operation names differ between replay paths. `SignedSyncEnvelopeReplayService#syncFromSignedMutation` preserves the signed mutation's `operation` as `syncType`, and routed `SyncEnvelopeReplayService` recognizes deletion only when that value is exactly `"delete"`. A routed signed delete must therefore declare and sign `operation: "delete"` in the manifest/grant contract. Do not send `operation: "destroy"` through routed signed replay: `"destroy"` is the built-in frontend-model endpoint convention, is not translated by the signed replay service, and—unless declared as a domain command—falls through to the routed upsert path.

`SyncClient` currently posts `{authenticationToken, syncs}` while `SignedSyncEnvelopeReplayService` accepts `signedMutations`. They are not drop-in counterparts. Keep the live-session path for operations it owns, or add only the thin app transport call needed to post signed entries to the configured signed replay resource; do not fork Velocious's verification/replay code. The separate built-in frontend-model replay envelope is `{mutations: [{...signedMutation, signedOfflineGrant}]}` posted to `/frontend-models/sync/replay`.

## 7. Use domain commands for invariant-heavy work

Raw attribute replay is appropriate for ordinary independent fields. Use a declared resource command when one action changes several rows, requires a transaction/lock, or must preserve a domain invariant:

```js
class TaskBoardResource extends FrontendModelBaseResource {
  static ModelClass = TaskBoard
  static memberCommands = ["moveCard"]
  static sync = {
    operations: ["index", "find", "moveCard"],
    policyVersion: "task-board-v1"
  }

  async moveCard({id, position, targetColumnId, taskId}) {
    return await this.locals.configuration.withTransaction(
      {databaseIdentifier: "default"},
      async (operation) => {
        // Authorize the board, hold a board-scoped advisory lock, move and
        // compact cards, then return a serializable command result.
        return {boardId: id, position, targetColumnId, taskId}
      }
    )
  }
}
```

A signed command mutation uses `operation: "moveCard"` and `payload: {id: boardId, taskId, targetColumnId, position}`. Routed replay recognizes only commands declared in `memberCommands` or `collectionCommands`; for a member command it overwrites any payload `id` with the envelope `resourceId`. Domain code must still validate payloads, authorize the exact records, use a transaction/lock where required, and emit only final changes. The executable `TaskBoard.moveCard` proof is linked below.

## 8. Handle conflicts explicitly

For routed update replay, pass the replay service:

```js
{
  conflictStrategy: {
    strategy: "optimisticVersion",
    versionAttribute: "updatedAt"
  }
}
```

`optimisticVersion` and `serverWins` are the only backend-routed strategies currently accepted. A conflict is checked only for routed updates with a non-null `baseVersion` and an existing record. The service serializes concurrent checks per resource identity with an advisory lock. A mismatch returns `syncState: "conflict"` with `affectedFields`, `baseVersion`, `localMutation`, `serverModel`, `serverVersion`, `suggestedResolution`, and `versionAttribute`; it does not apply, persist, publish, or run the after-apply tail.

The resource's normalized `static sync.conflictStrategy` participates in policy metadata, but it does not automatically configure `SyncEnvelopeReplayService`; pass the service option. `fieldThreeWay`, `lastWriterWins`, and `appendOnly` exist in the standalone conflict helper but are intentionally rejected by routed backend replay because it has no client base snapshot.

Use `applySyncReplayResultToLocalMutationLog(...)` for results whose top-level `status` is `success`, `applied`, `duplicate`, `conflict`, `rejected`, or `error`. A routed `SyncEnvelopeReplayService` item uses `syncState` instead, so map `successful`/`failed`/`conflict` explicitly with `mutationLog.updateStatus(...)` and retain the routed response as `syncResult`. Keep a conflict row until the UI/user resolves it or an explicit policy chooses the authoritative state.

## 9. Server sequence, snapshot, and catch-up

### App `Sync` model feed

The declarative `SyncClient` path uses an app sync/change model with `serverSequence`, `updatedAt`, and `id`. `ServerSequenceAllocator` plus `withServerSequence(...)` provide monotonic allocation. `SyncModelChangeFeedService` holds a stable high-water cursor, orders by `server_sequence`, and returns `{nextCursor, syncs, total, upToCursor}`. Each `SyncClient` scope persists its cursor and pulls until it reaches that high-water mark; realtime reconnection waits for subscription readiness and then pulls to close the gap.

This feed does not return `snapshot_required`. The app must retain enough change rows or seed initial local state through an authorized import before advancing the cursor.

### Grant-scoped built-in feed

The signed frontend-model endpoints use the framework-owned `frontend_model_sync_changes` table and a numeric sequence:

- `POST /frontend-models/sync/changes` (aliases `/frontend-models/sync/change-feed` and `/sync/changes`) accepts `signedOfflineGrant`, `afterSequence`, optional `upToSequence`, and `limit`.
- The first request (`afterSequence: 0`) includes a snapshot by default. Hold its `upToSequence` across every page so concurrent appends are read in a later catch-up page instead of changing the current page boundary.
- `POST /frontend-models/sync/snapshot` (alias `/sync/snapshot`) returns an authorized `index` snapshot for every sync-enabled resource and the sequence at which it was taken.
- When retention has passed the requested cursor, changes returns `status: "snapshot_required"`, the oldest/requested sequence, and a new scoped snapshot. Replace the scoped replica, store the snapshot's sequence, then resume after it.

Every read verifies the signed grant and scopes feed rows by the exact materialized grant scope. The current endpoint does not construct its request ability from the grant actor. Snapshot resource `index` calls still run through the request's frontend-model ability and resource scoping, so require a request identity consistent with the verified grant (or expose an app-owned endpoint that builds that actor ability) and implement index scoping as if the client were hostile.

Do not combine this numeric cursor with `SyncModelChangeFeedService`'s object cursor. Pick one catch-up path per resource/operation during rollout.

## Security checklist

- Treat frontend/shared JavaScript and local SQLite as untrusted, provisional state. The backend re-verifies signatures, grant/current policy, abilities, permitted attributes, model validation, and domain invariants.
- Long grant TTLs imply delayed revocation. Keep expiry bounded, refresh online, audit the signed actor/device/grant, and bump the resource policy version/hash when an old grant must stop authorizing replay.
- Keep roles, billing, tokens, credentials, security settings, and similarly high-risk resources online-only by omitting offline operations or disabling their sync resource.
- Build replay context from the original signer/grant. An HTTP uploader or forwarding peer must never become the mutation actor implicitly.
- Preserve the original device certificate and signed mutation while forwarding. Never deserialize a peer row and re-sign it as the forwarding device. Imported `peer-applied` rows are not automatically re-exported; any explicit app-owned forwarding transition/copy must preserve the original proof and provenance.
- Enforce both record authorization and attribute authorization. Ability-scoped lookup/create membership prevents cross-scope records; `permittedParams` or `writableAttributes` prevents privilege escalation through writable fields.
- Keep signing secrets/private backend keys server-only and device private keys in platform secure storage. The current offline grant uses backend HMAC verification keys and is not peer-verifiable without exposing a secret, so `importPeerMutationBundle` intentionally does not claim to verify grants.

## Troubleshooting

### Policy hash mismatch

`sync-replay-policy-hash-mismatch` means the mutation does not match the current manifest; `offline-grant-policy-hash-mismatch` means the grant entry, mutation, and current manifest disagree. Deploy matching shared policy, bootstrap a new grant, and create new mutations under its hash. Never rewrite a signed mutation or copy a current hash onto old payload data.

### Rejected mutation

Inspect the per-entry shape for the path in use. Routed replay returns `syncState: "failed"` with `reason` and sometimes `message`; built-in signed frontend replay returns an outer result `status: "error"` or a successful outer result whose `response.status` is `"error"`. Keep user-fixable validation/authorization failures in `rejected`, surface structured details, and report unexpected errors through the framework error channel.

### Structured conflict

Do not retry the same stale base version in a loop. Persist the complete `conflict` payload, show local versus authoritative fields, and either keep the server value or issue a new mutation based on the refreshed server version. A conflict creates no change-feed row.

### `peer_received_unapplied`

This is architecture/app vocabulary, not a current `LocalMutationLog` status. Check whether signature/certificate verification failed (`importPeerMutationBundle().rejected`) or whether app policy/local data prevented a provisional apply after import. Preserve the untouched bundle and original proof material for quarantine/forwarding, and do not mark the row `synced`. Do not add a second generic peer state machine in the app while the framework primitive is absent; keep the existing guarded fallback until that gap is implemented.

### Stale or expired grant

An expired grant always fails verification. A still-unexpired grant can also become stale when its resource is disabled, an operation is removed, or the policy hash changes. Reconnect and bootstrap a new grant; do not extend `expiresAt` locally or bypass current-manifest enforcement. If revocation latency is unacceptable, make the operation online-only.

### Unknown resource or attribute

Confirm the model name matches the registered frontend-model key or explicit `static modelName`, the operation appears in `static sync.operations`, and the backend wrapper is registered. For routed replay, add legitimate flat fields to `static writableAttributes`; for normal frontend-model writes, add them to `permittedParams`. Do not suppress `unknown-resource-type`, `sync-unknown-attribute`, or `frontend-model-attribute-error` by dropping input silently.

### Replay idempotency

Retries must preserve the original `actorUserId`, `actorDeviceId`, and `clientMutationId`, hence the same signed envelope. Peer import deduplicates that derived key. Model-backed `SyncEnvelopeReplayService` also stale-guards by actor/resource and `clientUpdatedAt`; configure a durable `syncModel` before relying on replay retry safety. The built-in `/frontend-models/sync/replay` response exposes an idempotency key but does not by itself make arbitrary domain commands idempotent—domain commands should enforce their own durable uniqueness when duplicate execution would be unsafe.

## Migration checklist: ad-hoc sync to framework-owned primitives

Use a feature flag and assign one owner per resource/operation throughout this sequence.

### Inventory and policy gate

- [ ] Inventory every local write, pull/snapshot endpoint, cursor, peer transfer, domain command, conflict rule, retry key, and authorization bypass in the current app.
- [ ] Classify resources as ordinary CRUD, invariant-heavy command, read-only offline, or online-only/high-risk.
- [ ] Record current scope/ability and writable-attribute rules, including nested fields. Any unscoped write blocks rollout.
- [ ] Define metrics for pending age/count, replay failures by reason, conflicts, snapshot resets, policy mismatches, and duplicate domain effects.

### Shared-resource gate

- [ ] Move portable static config, permits, validation hooks, and safe policy metadata into one shared resource.
- [ ] Add minimal backend and local wrappers with `static ModelClass` and `static SharedResource`; keep environment-only authorization/secrets in the backend wrapper.
- [ ] Register the backend wrapper and verify the generated manifest/policy hash.
- [ ] Replace backend-only imports/raw SQL in shared code with `this.model(...)` and portable query descriptors.
- [ ] Prove flat and nested `permittedParams` failures and the routed `writableAttributes` allowlist independently.

### Framework log and transport gate

- [ ] For live-session resources, declare local-model `static sync`, configure `sync.client`, start `syncClient()`, and declare only portable query scopes.
- [ ] Use the framework `Sync` model, scope store, endpoint posters, pull/replay loops, realtime bridge, and echo suppression. Do not add a handwritten resource map, cursor loop, generic queue, websocket channel, or payload normalizer.
- [ ] For signed/P2P resources, use a row-backed `LocalMutationLog`, framework device/signature helpers, and peer bundle helpers. Store private keys securely and grants/certificates durably.
- [ ] Ensure the old and new paths cannot enqueue or apply the same operation simultaneously.

### Backend replay and convergence gate

- [ ] Mount `SyncResourceBase`; implement only `authorizeChanges`, `scopeChangesQuery`, and service args/hooks the framework cannot infer.
- [ ] Route CRUD through registered resources and abilities. Use `static writableAttributes` for routed signed CRUD and `permittedParams` for normal frontend-model CRUD. Declare and sign routed deletion as `operation: "delete"`; reserve `"destroy"` for the built-in frontend-model endpoint convention.
- [ ] Convert multi-row/invariant-sensitive writes to declared domain commands with explicit authorization, transaction/lock, validation, and final change emission.
- [ ] For peer-forwarded uploads, use `SignedSyncEnvelopeReplayService` with a fail-closed actor/grant `abilityFactory`; prove uploader identity cannot replace signer identity.
- [ ] Configure conflict versioning and prove applied/rejected/conflict results update the durable log without duplicate publication.
- [ ] Choose one server change-feed/cursor family, exercise initial snapshot, stable paged catch-up, retention reset, reconnect gap closure, and scoped authorization.

### Rollout and fallback gate

- [ ] Shadow-read/compare authoritative results before enabling writes, then canary one low-risk resource/operation and one scope.
- [ ] Keep the old path read-only or fully disabled for canaried operations; never dual-write without a proved idempotent reconciliation design.
- [ ] Make fallback switch ownership atomically. Drain or translate pending rows before switching back; never replay one logical mutation with a new id.
- [ ] Stop rollout on authorization leakage, unknown-field acceptance, signer/provenance loss, unexplained duplicate effects, cursor gaps, or unbounded pending age.
- [ ] Do not fill a missing Velocious primitive with new hand-written generic app plumbing. Keep the existing guarded fallback and implement the reusable primitive in Velocious first.

### Removal gate

- [ ] All supported app versions use the framework path and old-version traffic has fallen below the agreed threshold.
- [ ] Pending legacy queues are empty or deterministically migrated, and rollback has been rehearsed from a production-like snapshot.
- [ ] Security/audit evidence covers grants, policy changes, signer provenance, abilities, permitted attributes, conflicts, snapshots, and duplicate retries.
- [ ] Remove old endpoints, tables/jobs/channels, serializers, state machines, and feature flags together; retain only domain hooks and app-owned storage/auth/device-enrollment boundaries.
- [ ] Delete migration-only compatibility after the observation window. Do not leave a second generic sync implementation as permanent fallback.

## Architecture and executable evidence

- [Offline Sync Architecture](offline-sync.md) — goals, threat model, and target contracts; read its implemented-slice labels and open decisions before treating a concept as available.
- [Frontend Model Resources](frontend-model-resources.md) — shared-resource fallback and sync manifest/hash rules.
- [Declarative Sync Client](sync-client.md) — local declarations, scopes, pending rows, pull/replay, and realtime.
- [Sync Envelope Replay Service](sync-envelope-replay-service.md) — routed replay hooks, ability flow, permits, commands, and structured conflict response.
- [AwesomeTasks offline sync proof](awesome-tasks-offline-sync-proof.md) — the integrated proof and its boundaries.
- [`spec/frontend-model-resource/base-resource-spec.js`](../spec/frontend-model-resource/base-resource-spec.js) and [`spec/frontend-models/writable-attributes-permit-bridge-spec.js`](../spec/frontend-models/writable-attributes-permit-bridge-spec.js) — fallback order and permit behavior.
- [`spec/controller/frontend-model-sync-bootstrap-spec.js`](../spec/controller/frontend-model-sync-bootstrap-spec.js) and [`spec/controller/frontend-model-sync-replay-spec.js`](../spec/controller/frontend-model-sync-replay-spec.js) — grants, signed replay, numeric feed, snapshots, and catch-up.
- [`spec/sync/awesome-tasks-offline-peer-sync-end-to-end-spec.js`](../spec/sync/awesome-tasks-offline-peer-sync-end-to-end-spec.js) — peer forwarding, authorization rejection, conflicts, and convergence.
- [`spec/sync/awesome-tasks-task-board-move-card-spec.js`](../spec/sync/awesome-tasks-task-board-move-card-spec.js) — transactional domain command behavior.
- [`spec/sync/peer-mutation-bundle-spec.js`](../spec/sync/peer-mutation-bundle-spec.js), [`spec/sync/local-mutation-log-spec.js`](../spec/sync/local-mutation-log-spec.js), and [`spec/sync/query-scope-spec.js`](../spec/sync/query-scope-spec.js) — durable log, provenance-preserving peer exchange, and portable scope limits.
