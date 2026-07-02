# Changelog

- Add `SyncResourceBase` (`src/sync/sync-resource-base.js`): a server sync resource base owning changes/replay orchestration — optional client scope parsing (`{resourceType, conditions}`), change-feed construction, and replay delegation/response shaping — so apps only implement `authorizeChanges`, `scopeChangesQuery`, and `replayServiceClass`.
- Add model-backed default hooks to `SyncEnvelopeReplayService`: passing `syncModel` (and optionally `actorForeignKeyColumn`) to the constructor enables default `findExistingReplaySync` (actor + resource identity lookup) and `persistReplayMutation` (stale-guarded upsert with server re-sequencing), removing per-app duplication.
- Auto-mount the Velocious sync endpoints from configuration: `sync.api = {resourceClass, mountPath?}` registers `POST <mountPath>/changes` and `POST <mountPath>/replay` during `initialize()` (default mount path `/velocious/sync`). The manual `route.mount(SyncApiController, ...)` path keeps working.
