# Changelog

- Add a declarative client-side `SyncClient` (`src/sync/sync-client.js`): apps configure resources, transport, auth, and connectivity once; Velocious owns sync-scope persistence (auto-created `velocious_sync_scopes` table), per-scope cursors, pull paging/apply, declarative local queueing, and online-gated single-flighted replay. Scopes are declared from model queries — `syncClient.sync(Event.where({partnerId}))` or `Event.where({partnerId}).sync()` — and sent to the server in each changes payload. New-scope cursors can be seeded through a `legacyCursor` hook so existing devices don't re-pull everything. See `docs/sync-client.md`.
- Add `getWheres`/`getJoins`/`getLimit`/`getOffset`/`getOrders` accessors to the query layer and `sync()`/`unsync()` on model queries (delegating through a dependency-free sync-client registry so client bundles stay lean).
- Extract the shared stable JSON serializer into `src/sync/stable-json.js`.
