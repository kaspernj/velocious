# AwesomeTasks offline sync proof

This document records the Velocious-only integration proof for task `ac926b23-103a-5dc5-9e4d-04aa1fa270bb`. It exercises the generic offline-sync primitives that AwesomeTasks can adopt without adding a parallel write path or duplicating framework mechanics in the app.

## What is proven

1. **Generic offline Task create/update and Comment create**
   - Mutations route through registered frontend-model resources (`TaskFrontendResource`, `SystemTestCommentFrontendResource`).
   - Payloads are filtered by the resource's `writableAttributes` permit list.
   - Missing records are created with the client-generated primary key; existing records are updated through `assign` + `save`.
   - Unknown attributes fail the sync as a client-safe per-envelope error.

2. **Domain command: `TaskBoard.moveCard`**
   - `TaskBoardSyncResource` exposes `moveCard` as a resource command.
   - `SyncEnvelopeReplayService` dispatches non-create/update/delete `syncType` values to the matching resource command method.
   - The whole move runs inside a transaction and holds a board-scoped advisory lock for the duration of the operation; database drivers that support advisory locks serialize concurrent moves on the same board.
   - A collision-free temporary position is derived from the current max position in the target column while the lock is held, so the shuffle cannot collide with a legitimate card.
   - Command-owned card saves are marked as server applies so an active `SyncPublisher` does not publish intermediate shuffle positions; only the final `TaskBoard` change-feed row is emitted.
   - A persisted sync/change row captures the mutation and advances the server sequence, making the move available to the change feed.

3. **Long-offline and peer-forwarded signed mutations**
   - `SignedSyncEnvelopeReplayService` authenticates replay from backend-signed device certificates and signed offline grants instead of a live session token.
   - The uploader may differ from the original actor; replay authority is derived from the signed envelope and grant.
   - Expired grants, actor/device/grant mismatches, unauthorized operations, and a missing `actorLookup` result fail client-safely without applying domain changes.
   - Verified actor and derived syncs are passed through request-local state so concurrent replay calls on one service instance cannot cross authentication state.
   - Verified mutations are transformed into the generic sync envelope shape and replayed by the same routed-resource path.

4. **Current-policy enforcement on signed replay**
   - Every signed mutation is validated against the current sync manifest (the same contract as the controller's sync replay endpoint): the model and operation must be enabled in the current manifest, and the mutation's policy hash must equal the manifest policy hash.
   - The grant's resource entry must be a normalized bootstrap manifest entry (`enabled` with an `operations` list and the current `policyHash`); its policy hash must equal both the mutation and current manifest hashes, so grants issued under a revoked or changed policy stop replaying.
   - Legacy array/`true` grant-resource shortcuts never authorize a signed mutation.

5. **Actor/grant-scoped authorization**
   - The verified actor and common grant (with its scopes) travel request-locally into the replay context (`currentUser`, `offlineGrant`, `offlineGrantScopes`, `resourceRuntime: "offline"`).
   - Routed resources are authorized through an ability built by the service's `abilityFactory` from the verified actor and grant — never from constructor-wide uploader ability. Without a factory result, routed signed replay fails closed per sync.
   - The proof scopes `Task`/`TaskBoard` access to the grant's project scope: a project-A grant cannot update a project-B task or move a card on a project-B board, while same-project replay succeeds.

## App-side surface kept minimal

The dummy-app fixture only adds:

- Migration and models for `TaskBoard` and `TaskBoardCard`.
- A small `TaskBoardSyncResource` declaring `writableAttributes`, `memberCommands`, a `sync` policy declaration, and the `moveCard` handler; its board lookup applies the request ability when one is present.
- `sync` policy declarations on the existing Task resource so the current-manifest contract covers it.
- Registration of the resource and permitted params in `backend-projects.js`.
- A proof `abilityFactory` (in `spec/helpers/signed-sync-replay-helper.js`) scoping Task/TaskBoard abilities to the grant's project scope.

All generic orchestration lives in Velocious:

- `src/sync/sync-envelope-replay-service.js` — batch auth, normalization, stale-guard, routed-resource dispatch, command dispatch, and the `replayAbilityFor` authorization hook.
- `src/sync/signed-sync-envelope-replay-service.js` — certificate/offline-grant verification, current-policy and grant-policy enforcement, request-local actor/grant context, and fail-closed actor/grant-scoped ability derivation.
- `src/sync/sync-replay-upsert-applier.js` — declarative upsert applier used by legacy `applyHandlers`.

## What is not claimed

The proof demonstrates the behavior above under the locking and transaction mechanisms that the current database API exposes. It does not claim full concurrency safety beyond the tested advisory-lock path; drivers or configurations that do not implement advisory locks need their own isolation story.

## Specs

- `spec/sync/awesome-tasks-task-comment-sync-spec.js` — Task/Comment routed replay and permit-list rejection.
- `spec/sync/awesome-tasks-task-board-move-card-spec.js` — `TaskBoard.moveCard` ordering, atomic move, publish suppression, column moves, and error handling.
- `spec/sync/awesome-tasks-signed-offline-sync-spec.js` — long-offline Task update, expired-grant rejection, missing-actor failure, concurrent two-actor isolation, and peer-forwarded `moveCard`.
- `spec/sync/awesome-tasks-signed-policy-enforcement-spec.js` — current-manifest and grant-policy enforcement: disabled/stale/current policy cases and legacy-shortcut rejection.
- `spec/sync/awesome-tasks-signed-scope-authorization-spec.js` — cross-project denial for Task updates and `moveCard`, same-project success, ability-factory actor/grant delivery, and fail-closed replay without a factory.

## See also

- [`docs/sync-envelope-replay-service.md`](sync-envelope-replay-service.md) — generic replay service contract.
- [`docs/offline-sync.md`](offline-sync.md) — local-first sync architecture goals and contracts.
