# Changelog

- Local sync rows edited while their old payload is in flight now stay pending instead of being marked successful, so the newer local change replays on the next drain instead of being lost (`SyncApiClient.replayLocalSyncs` compares a per-row payload snapshot before marking success).
- Queued sync rows now use the stable Velocious model name (`getModelName()`) as `resourceType` instead of the JavaScript class name, which breaks under explicit model names and minified bundles; records without a model class fail loudly.
- `SyncApiClient.singleFlight` callers queued behind a failed flight now run their own work after the lock clears instead of rejecting with the previous flight's error, so pending rows retry after transient replay failures.
- Document the auto-mounted server sync API (`sync.api` configuration, `SyncResourceBase` subclass contract) in `docs/offline-sync.md` and the model-backed replay defaults in `docs/sync-envelope-replay-service.md`.
- Cover the model-backed replay defaults against the real dummy-app database (new `sync_entries` dummy model) in addition to the unit fakes.
