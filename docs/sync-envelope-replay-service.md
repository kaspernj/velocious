# Sync envelope replay service

`SyncEnvelopeReplayService` is a small server-side primitive for apps that need to replay already-collected client sync envelopes through application-specific auth, authorization, persistence, and domain handlers.

It is not a separate legacy sync framework. The service only owns the generic batch orchestration that is useful while apps migrate sync writes toward Velocious resources and domain commands:

- authenticate the replay actor once per batch
- normalize each envelope into a stable mutation shape
- parse object or JSON-string payloads
- compare client timestamps against an existing sync/change row
- skip stale mutations without applying domain changes
- return per-envelope success/failure responses
- call app-supplied hooks for auth, access checks, persistence, side effects, and domain mutation dispatch

Apps still own token lookup, actor/device policy, model-specific write handlers, and the sync/change table they persist into.

## Import path

```js
import SyncEnvelopeReplayService from "velocious/build/src/sync/sync-envelope-replay-service.js"
```

## Minimal subclass

```js
class AppSyncReplayService extends SyncEnvelopeReplayService {
  async authenticateReplay(params) {
    const actor = await findActorFromToken(params.authenticationToken)

    if (!actor) {
      return {
        authenticated: false,
        errorCode: "invalid-authentication-token",
        errorMessage: "Invalid authentication token"
      }
    }

    return {authenticated: true, actor}
  }

  async authorizeReplayMutation({actor, mutation}) {
    if (!actor.canReplay(mutation.resourceType, mutation.resourceId)) {
      return {allowed: false, reason: "access-denied"}
    }

    return {allowed: true}
  }

  async findExistingReplaySync({mutation}) {
    return await AppSync.findBy({
      resourceId: mutation.resourceId,
      resourceType: mutation.resourceType
    })
  }

  async applyReplayMutation({mutation}) {
    return await replayDomainMutation(mutation)
  }

  async persistReplayMutation({applyResult, mutation, shouldApply}) {
    await AppSync.upsertReplayResult({applyResult, mutation, shouldApply})
  }
}
```

Call `replay(params)` with request params that contain a `syncs` array. The default envelope fields are:

- `id`: client sync row id, echoed in per-envelope responses
- `resourceType`: model/resource name
- `resourceId`: model/resource id, normalized to a string
- `syncType`: operation or app-specific command type
- `clientUpdatedAt`: client mutation timestamp; invalid/missing values fall back to the current server time
- `data`: object payload or JSON string payload, normalized to a plain object

The response shape is compatible with batch replay clients:

```js
{
  syncs: [
    {id: 12, syncState: "successful"},
    {id: 13, syncState: "failed", reason: "access-denied"}
  ]
}
```

## Hook contract

Override these methods as needed:

- `authenticateReplay(params)`: required. Return `{authenticated: true, actor}` or `{authenticated: false, errorCode, errorMessage}`.
- `buildReplayContext({actor, params})`: optional per-batch cache/context object.
- `replaySyncs(params)`: optional custom extraction of raw envelopes. Defaults to `params.syncs`.
- `authorizeReplayMutation({actor, context, mutation})`: optional per-envelope access check. Defaults to allowed.
- `findExistingReplaySync({actor, context, mutation})`: optional current sync/change lookup.
- `shouldApplyReplayMutation({actor, context, existingSync, mutation})`: optional stale/conflict decision. Defaults to comparing `mutation.clientUpdatedAt` against `existingReplaySyncClientUpdatedAt(existingSync)`.
- `applyReplayMutation({actor, context, existingSync, mutation})`: optional app/domain mutation dispatcher.
- `skippedReplayMutation({actor, context, existingSync, mutation})`: optional apply result for stale skipped envelopes.
- `persistReplayMutation({actor, context, existingSync, applyResult, mutation, shouldApply})`: optional sync/change persistence hook.
- `afterReplayMutation({actor, context, existingSync, applyResult, mutation, shouldApply})`: optional side-effect hook after persistence.

`existingReplaySyncClientUpdatedAt(existingSync)` accepts either a raw `clientUpdatedAt` property or a `clientUpdatedAt()` accessor. The value may be a `Date` or a parseable timestamp string.

## Boundary

Use this service only for replaying envelopes through app-owned hooks. Do not put app-specific resource policy, scanner/device token rules, or model mutation logic in Velocious. New sync implementations should still move toward signed offline mutations, resource/domain-command replay, and server-sequenced change feeds described in [`offline-sync.md`](offline-sync.md).
