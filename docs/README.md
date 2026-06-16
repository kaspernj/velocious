# Velocious Docs

This folder contains implementation learnings and practical guidance discovered while building and integrating Velocious.

## Index
- `docs/advisory-locks.md`: Cooperative, connection-scoped advisory lock helpers on every record class.
- `docs/background-jobs.md`: Background job operational behavior, including failure events for production error reporting.
- `docs/database-migrations.md`: Migration helpers, implicit primary keys, and reference column defaults.
- `docs/http-server.md`: HTTP server worker configuration and socket distribution behavior.
- `docs/expo-metro-compatibility.md`: Expo/Metro integration rules and the repository Expo export check.
- `docs/frontend-models.md`: Frontend model transport, commands, lookup semantics, and pitfalls.
- `docs/query-bulk-operations.md`: `updateAll` for efficient batch updates and `destroyAll` behavior.
- `docs/logging.md`: Rails-style request and database query logging behavior.
- `docs/mailers.md`: EJS mailer templates, direct delivery, background delivery, and payload rendering.
- `docs/model-initialization.md`: Eager and lazy record/frontend-model initialization behavior.
- `docs/schema-metadata-cache.md`: Driver schema metadata caching, invalidation, and disabling.
- `docs/tenant-databases.md`: Tenant-only database identifiers and tenant lifecycle commands.
- `docs/frontend-model-resources.md`: Resource recipe requirements for generated frontend models.
- `docs/translations.md`: Translated record attributes, `currentTranslation`, and translated frontend-model sorting.
- `docs/routing-hooks-and-autoroutes.md`: Route hook support and frontend-model autoroute behavior.
- `docs/authorization-and-current.md`: Ability usage, `Current`, and `accessible`/`accessibleBy` behavior.
- `docs/relationships.md`: Relationship types, through (many-to-many) relationships, and preloading behavior.
- `docs/testing-guidelines.md`: Browser/system test guidance and why end-to-end coverage is preferred.

## Working Agreement
When new behavior, constraints, edge cases, or integration caveats are discovered, add/update docs in this folder in the same change so knowledge stays current.
