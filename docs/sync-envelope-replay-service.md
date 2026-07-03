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

## Model-backed defaults

Passing a sync model to the constructor enables default implementations of `findExistingReplaySync` and `persistReplayMutation`, so apps persisting into a standard sync/change table override neither:

```js
class AppSyncReplayService extends SyncEnvelopeReplayService {
  constructor(args = {}) {
    super({logger: args.logger, syncModel: Sync})
  }
}
```

- `findExistingReplaySync` looks the row up by actor + resource identity: `{[actorForeignKeyColumn]: actor.id(), resource_id, resource_type}`. `actorForeignKeyColumn` defaults to `"authentication_token_id"` and can be passed to the constructor.
- `persistReplayMutation` performs a stale-guarded upsert: existing rows newer than the mutation stay untouched, older rows get `assign` + `advanceServerSequence()` + `save`, and missing rows are created.
- The sync model must expose `findBy`/`create` statics plus instance `assign`/`save`/`clientUpdatedAt` and `advanceServerSequence` (the change-feed sequence contract), and the actor returned from `authenticateReplay` must expose an `id()` method. `withServerSequence` + `ServerSequenceAllocator` provide `advanceServerSequence` and initial-sequence assignment declaratively — see the server sequence allocation slice in [`offline-sync.md`](offline-sync.md).
- `replayPersistAttributes({actor, mutation})` builds the persisted attributes hash and can be reused by apps that only enrich it (for example with an `event_id`) before persisting themselves.

## Declarative configuration

Beyond the model-backed defaults, the constructor accepts declarative options so most apps override no hooks at all:

```js
new AppSyncReplayService({
  authenticationTokenModel: AuthenticationToken, // + authenticationTokenColumn/authenticationTokenParam
  syncModel: Sync,
  applyHandlers: {
    Event: {
      modelClass: Event,
      fields: {pytId: "stringOrNull", title: "stringOrNull", startsAt: "dateOrNull", visible: "booleanOrNull"},
      afterApply: async ({record}) => ({appliedEventId: record.id()}) // domain tail; merges into the apply result
    },
    TicketScan: async (args) => await new TicketScanSyncCommandService().apply(args) // full custom handler
  },
  persistExtraAttributes: ({applyResult}) => ({event_id: applyResult.appliedEventId}),
  persistSerializedData: ({applyResult}) => applyResult.serializedData,
  broadcaster: async ({channel, params, body}) => configuration.broadcastToChannel(channel, params, body),
  broadcasts: [{
    channel: "ticket-scans",
    broadcastParams: ({applyResult}) => ({eventId: applyResult.appliedEventId, mandantenNr: applyResult.mandantenNr}),
    body: ({applyResult}) => applyResult.published,
    when: ({applyResult}) => Boolean(applyResult.published)
  }]
})
```

- **Token auth**: with `authenticationTokenModel`, the default `authenticateReplay` looks the token up by `authenticationTokenColumn` from `params[authenticationTokenParam]` and returns the standard missing/invalid error codes.
- **Apply-handler registry**: the default `applyReplayMutation` dispatches by `mutation.resourceType`; a mutation without a registered handler fails loudly. Declarative specs are executed by `SyncReplayUpsertApplier` (`src/sync/sync-replay-upsert-applier.js`), which owns present-key filtering, per-field coercion (`stringOrNull`, `booleanOrNull` incl. sqlite 0/1, `integerOrNull`, `floatOrNull`, `dateOrNull`, `raw`), unknown-key rejection (`restArgs: "ignore"` opts out), the find-or-create upsert, the delete branch, an optional `serialize` snapshot (landing on `applyResult.serializedData`), and the `afterApply` domain tail.
- **Persist extension points**: `persistExtraAttributes` merges app columns (e.g. event scoping) into the model-backed persisted row; `persistSerializedData` overrides the persisted `data` payload (objects are JSON stringified).
- **Broadcast fan-out**: the default `afterReplayMutation` runs each declarative broadcast through the injected `broadcaster`; `when` gates skip irrelevant mutations. Configuring `broadcasts` without a `broadcaster` fails at construction time.

## Resource-routed replay

Instead of per-resourceType `applyHandlers`, the service can route mutations through the app's registered frontend-model resource classes. Pass a `configuration` (its `frontendModels` registry resolves `mutation.resourceType`, honoring `static modelName` overrides) and/or `resourceTypeOverrides` (a resource class, or a string alias resolved through the registry). `SyncResourceBase#buildReplayService` plumbs `configuration`, `ability`, `abilityContext` and `locals` in automatically and defaults `replayServiceClass()` to `SyncEnvelopeReplayService`, so a sync resource with registered frontend models needs no replay wiring at all.

```js
class TicketResource extends FrontendModelBaseResource {
  static ModelClass = Ticket

  // Entries can be `true` (fully inferred from column metadata: type,
  // maxLength, required) or partial objects overriding inferred fields.
  static writableAttributes = {
    barcode: true,
    scannedAt: {invalid: "null", type: "date"},
    title: true
  }

  abilities() {
    this.can(["create", "update", "destroy"], {eventId: this.context.currentEventIds})
  }

  syncAuthorizationFailureReason({action}) {
    return action == "create" ? "ticket-create-denied" : null
  }
}

new SyncEnvelopeReplayService({
  ability,
  abilityContext: {currentEventIds},
  configuration, // frontendModels registry routing
  resourceTypeOverrides: {LegacyTicket: "Ticket", Special: SpecialResource},
  syncModel: Sync
})
```

The routed default apply flow per mutation:

1. `applyHandlers` keep precedence — a matching handler wins over routing (compat).
2. Unresolvable resource types fail that single sync with `reason: "unknown-resource-type"`; the batch continues.
3. `resource.applySync(args)` returning non-null replaces the whole flow (full escape hatch).
4. `resource.authorizeSyncMutation({context, mutation})` returning `{allowed: false, reason}` fails the sync with that reason.
5. Deletes: `findSyncRecord({forDelete: true, mutation})` (ability-scoped through the resource's normalized `destroy` ability action); missing records no-op; `syncDeleteBehavior() === "ignore"` keeps the record; otherwise it is destroyed.
6. Upserts: `mutation.data` is normalized through `syncWritableAttributes()` (defaults to the resolved `writableAttributes` schema — declaring neither fails loudly). Found records (via the `update`-scoped `findSyncRecord`) get `assign` + `save`. Missing records follow `syncMissingRecordBehavior()`: `"ignore"` no-ops, the default creates the record with the client-generated primary key (`mutation.resourceId`) and then verifies create-scope membership when an ability is configured — records outside the ability's `create` scope are destroyed again and the sync fails with `syncAuthorizationFailureReason({action: "create", mutation})` (default `"access-denied"`).
7. `afterSyncApply({context, created, mutation, record})` extras merge into the apply result, reaching `persistExtraAttributes` and broadcasts.

`shouldApplySync({existingSync, mutation})` on the routed resource can force-apply or force-skip before the timestamp default decides.

Per-sync failure semantics: every client-safe apply failure (`VelociousError` with `safeToExpose`) — schema validation errors, model validation errors (converted with their translated `ValidationError` message and `reason: "validation-error"`), authorization denials, unknown resource types — fails only that sync with `{id, syncState: "failed", reason, message}` and the batch continues. Unexpected errors keep propagating and fail the request.

## Boundary

Use this service only for replaying envelopes through app-owned hooks. Do not put app-specific resource policy, scanner/device token rules, or model mutation logic in Velocious. New sync implementations should still move toward signed offline mutations, resource/domain-command replay, and server-sequenced change feeds described in [`offline-sync.md`](offline-sync.md).
