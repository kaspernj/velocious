# Frontend Models

## Core transport
- Frontend models run over HTTP transport, not local database connections.
- Transport should be configured once via `FrontendModelBase.configureTransport(...)` (or wrapper APIs built on top of it).
- Keep request execution centralized in Velocious instead of per-project endpoint overrides.

## Frontend vs backend model API differences
- Frontend models expose a narrower query surface (mainly `find`, `findBy`, `findByOrFail`, `toArray`, `where`, `sort`, `order`, `group`, `count`) and do not expose the full backend query API (`joins`, `limit`, `distinct`, `findOrCreateBy`, etc.).
- Frontend model commands are resource-mapped; `toArray()` calls the configured `index` command, which may map to a backend command name like `list` instead of literal `index`.
- Frontend models are HTTP/resource-transport based; backend models run against direct database model/query APIs.

## Commands and URL mapping
- Generated model commands must preserve backend resource command mappings.
- If backend `commands.index` is custom (not literally `index`), generated frontend models must call the mapped command URL.
- `toArray()` should execute the model's configured index command, not assume `/index`.

## Lookup API
- `findBy(conditions)` returns the first matching model or `null`.
- `findByOrFail(conditions)` throws when no matching record exists.
- Date condition values are normalized through JSON serialization to align request and local matching semantics.

## Condition validation rules
- Reject `undefined` condition values.
- Reject non-plain object condition values (for example `RegExp`, `Map`, `Set`, functions, symbols) to avoid weakened/ambiguous filters.
- `null` conditions should only match explicit `null`, not missing/undefined attributes.
- Nested object/array condition values are matched by value, not object identity.

## Matching behavior
- Local re-checking of returned models is kept for safety when backend handlers may return broader sets.
- Avoid forcing `limit: 1` in `findBy` payloads, because that can produce false negatives if backend filtering is incomplete.

## Generation expectations
- Frontend model files in app projects are generated artifacts.
- Fix generator/source behavior in Velocious instead of hand-editing generated output.
- Generated files should include valid JSDoc typing.
