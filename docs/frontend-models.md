# Frontend Models

## Core transport
- Frontend models run over HTTP transport, not local database connections.
- Transport should be configured once via `FrontendModelBase.configureTransport(...)` (or wrapper APIs built on top of it).
- Keep request execution centralized in Velocious instead of per-project endpoint overrides.

## Frontend vs backend model API differences
- Frontend models expose a narrower query surface (mainly `find`, `findBy`, `findByOrFail`, `findOrInitializeBy`, `findOrCreateBy`, `toArray`, `where`, `joins`, `sort`, `order`, `group`, `distinct`, `pluck`, `count`, `limit`, `offset`, `page`, `perPage`) and do not expose the full backend query API (raw SQL joins, etc.).
- Frontend model commands are resource-mapped; `toArray()` calls the configured `index` command, which may map to a backend command name like `list` instead of literal `index`.
- Query `load()` is the explicit "always fetch" path; `toArray()` remains the common array reader and relationship helpers can reuse preloaded data before fetching.
- Frontend models are HTTP/resource-transport based; backend models run against direct database model/query APIs.

## Commands and URL mapping
- Generated model commands must preserve backend resource command mappings.
- If backend `commands.index` is custom (not literally `index`), generated frontend models must call the mapped command URL.
- `toArray()` should execute the model's configured index command, not assume `/index`.

## Lookup API
- `findBy(conditions)` returns the first matching model or `null`.
- `findByOrFail(conditions)` throws when no matching record exists.
- `findOrInitializeBy(conditions)` returns existing model or a new unsaved model.
- `findOrCreateBy(conditions, callback)` returns existing model or creates a new model.
- Date condition values are normalized through JSON serialization to align request and local matching semantics.

## Ransack filtering and sorting
- `ransack(params)` applies Rails-compatible ransack filters and sorting on both frontend and database model queries.
- Supported predicates: `eq`, `notEq`, `in`, `notIn`, `gt`, `gteq`, `lt`, `lteq`, `cont`, `start`, `end`, `null`.
- Keys can be snake_case or camelCase: `nameCont` and `name_cont` are both valid.
- The `s` key applies sorting: `ransack({s: "name asc"})` sorts by name ascending.
- Multiple sort columns can be specified: `ransack({s: "name asc, createdAt desc"})`.
- Relationship paths are resolved automatically: `ransack({projectNameCont: "foo"})` filters through the `project` relationship.
- Example combining filter and sort: `User.ransack({emailCont: "john", s: "name asc"}).toArray()`.

## Query parity helpers
- `all()` returns a query builder (parity with backend `all()`).
- `order(...)` is available as alias parity with backend `order(...)` (and forwards to frontend sort payloads).
- `first()` and `last()` are available on frontend query/model classes.
- `search(path, column, operator, value)` supports both named operators (`gt`, `lt`, `gteq`, `lteq`) and symbolic aliases (`>`, `<`, `>=`, `<=`).

## Nested attributes on `save()`
- Parents can save dirty `hasMany` children in the same request via Rails-style nested-attribute writes. See [nested-attributes.md](nested-attributes.md) for the full feature doc.
- Requires a two-layer opt-in: `Model.acceptsNestedAttributesFor(name, options)` on the backend `Record` subclass (policy: `allowDestroy`, `limit`, `rejectIf`) and an overridden `permittedParams(arg)` method on the resource (flat Rails-style array mixing attribute names with `{<relationshipName>Attributes: [...]}` objects).
- `markForDestruction()` / `markedForDestruction()` on any frontend-model instance flags a loaded child for destruction on the next parent `save()`. To actually destroy, include `"_destroy"` in the nested permit AND set `allowDestroy: true` on the model.
- The `save()` walker includes only dirty children (new / changed / marked-for-destruction / with dirty descendants); loaded-but-untouched children are omitted.

## Record parity helpers
- `save()` is available for create/update flows (`create` when new record, `update` when persisted). With nested attributes enabled, it also carries dirty children in the same request.
- `create(attributes)` is available on frontend model classes.
- `isNewRecord()`, `isPersisted()`, `changes()`, and `isChanged()` are available on frontend model instances.
- Relationship parity helpers are available via `loadRelationship(name)` / `relationshipOrLoad(name)` / `setRelationship(name, value)` and generated `loadXxx` / `xxxOrLoad` / `setXxx` methods where applicable.
- Has-many relationship helpers support `await model.relationshipName().toArray()` to reuse preloaded data and `await model.relationshipName().load()` to force a refresh.

## Attachment support
- Frontend models can define `resourceConfig().attachments` and use generated attachment handles:
  - `await model.attachmentName().attach(fileLikeOrBase64Payload)`
  - `const attachment = await model.attachmentName().download()`
  - `const attachmentUrl = await model.attachmentName().url()`
- Backend attachment command mapping supports `attach`, `download`, and `url` command names in resource `commands`.
- Frontend attachment input supports `File`/`Blob` (`arrayBuffer()`), bytes, and `{contentBase64, filename?, contentType?}` payloads.
- Frontend attachment input does not support `{path: ...}`.

## Condition validation rules
- Reject `undefined` condition values.
- Reject non-plain object condition values (for example `RegExp`, `Map`, `Set`, functions, symbols) to avoid weakened/ambiguous filters.
- `null` conditions should only match explicit `null`, not missing/undefined attributes.
- Nested object/array condition values are matched by value, not object identity.
- Frontend-model `where(...)` supports nested relationship descriptors (for example `{project: {creatingUser: {reference: "owner-b"}}}`) and should stay descriptor-only (no raw SQL fragments).
- Frontend-model `joins(...)` supports relationship-object descriptors only (for example `{project: {creatingUser: true}}`) and rejects raw SQL join strings.

## Matching behavior
- Local re-checking of returned models is kept for safety when backend handlers may return broader sets.
- Avoid forcing `limit: 1` in `findBy` payloads, because that can produce false negatives if backend filtering is incomplete.

## Generation expectations
- Frontend model files in app projects are generated artifacts.
- Fix generator/source behavior in Velocious instead of hand-editing generated output.
- Generated files should include valid JSDoc typing.
- Generated shared-endpoint models should emit stable `resourceConfig().modelName` metadata so production-minified class names do not break backend model lookup.
