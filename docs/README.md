# Velocious Docs

This folder contains implementation learnings and practical guidance discovered while building and integrating Velocious.

## Index
- `docs/advisory-locks.md`: Cooperative, connection-scoped advisory lock helpers on every record class.
- `docs/api-manifest-endpoint.md`: Built-in frontend-model API manifest endpoint — opt-in, token-protectable, returns resource/attribute/command metadata as pretty-printed JSON.
- `docs/attachments.md`: Backend record attachment inputs, storage drivers, path allowlisting/streaming, and persistence lifecycle.
- `docs/auditing.md`: Built-in lifecycle audit rows, manual audit events, and audit-missing scopes.
- `docs/background-jobs.md`: Background job operational behavior, including failure events for production error reporting.
- `docs/cli.md`: CLI process exit behavior for successful and rejected commands.
- `docs/database-migrations.md`: Migration helpers, UTC datetime storage, implicit primary keys, and reference column defaults.
- `docs/docker-development-environment.md`: Canonical `dev` Compose service, development-home bind contract, credential boundary, and the static contract verifier.
- `docs/operation-scoped-transactions.md`: Explicit singular-database transactions with operation-bound models, records, savepoints, commit callbacks, and pool isolation.
- `docs/http-server.md`: HTTP server worker configuration, socket distribution behavior, buffered response compression, and HEAD response semantics.
- `docs/expo-metro-compatibility.md`: Expo/Metro integration rules and the repository Expo export check.
- `docs/frontend-models.md`: Frontend model transport, commands, lookup semantics, and pitfalls.
- `docs/query-bulk-operations.md`: `updateAll` for efficient batch updates and `destroyAll` behavior.
- `docs/rampway-integration.md`: Mounting and operating Rampway's package-owned durable deployment control plane in a Velocious application.
- `docs/logging.md`: Rails-style request and database query logging behavior.
- `docs/mailers.md`: EJS mailer templates, direct delivery, background delivery, and payload rendering.
- `docs/model-initialization.md`: Eager and lazy record/frontend-model initialization behavior.
- `docs/offline-sync.md`: Target architecture for local-first shared-resource sync, offline grants, peer transfer, and server-sequenced replay.
- `docs/shared-resource-sync-guide.md`: Source-verified developer guide and gated migration checklist for shared resources, signed/P2P replay, and server catch-up.
- `docs/live-queries.md`: `useLiveQuery` reactive local-model-change queries, the record-change bus, batching, and the invalidation cost model.
- `docs/sync-envelope-replay-service.md`: Server-side sync envelope replay hook contract for app-owned sync receivers.
- `docs/schema-metadata-cache.md`: Driver schema metadata caching, invalidation, and disabling.
- `docs/sqlite-web-persistence.md`: SQLite web persistence backend auto-selection: OPFS, IndexedDB, and legacy-byte migration.
- `docs/tenant-databases.md`: Tenant-only database identifiers and tenant lifecycle commands.
- `docs/tenant-selected-database-generation.md`: Explicit, immutable tenant database selection for base-model and structure generation.
- `docs/test-profiling.md`: Opt-in test profiling, rich JSON/privacy guarantees, custom activity spans, timing-manifest generation, and strict shard aggregation.
- `docs/test-transaction-sessions.md`: Backend-owned shared rollback sessions for live external services, workers, and exact tenant physical identities.
- `docs/frontend-model-resources.md`: Resource recipe requirements for generated frontend models.
- `docs/translations.md`: Translated record attributes, `currentTranslation`, and translated frontend-model sorting.
- `docs/routing-hooks-and-autoroutes.md`: Route hook support and frontend-model autoroute behavior.
- `docs/authorization-and-current.md`: Ability usage, `Current`, and `accessible`/`accessibleBy` behavior.
- `docs/relationships.md`: Relationship types, dependent destroy/restrict behavior, through (many-to-many) relationships, and preloading behavior.
- `docs/testing-guidelines.md`: Browser/system test guidance, database cleanup batching, and why end-to-end coverage is preferred.

## Working Agreement
When new behavior, constraints, edge cases, or integration caveats are discovered, add/update docs in this folder in the same change so knowledge stays current.
