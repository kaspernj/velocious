# Frontend Models

## Core transport
- Frontend models run over HTTP transport, not local database connections.
- Transport should be configured once via `FrontendModelBase.configureTransport(...)` (or wrapper APIs built on top of it).
- `FrontendModelBase.waitForIdle()` waits until queued, scheduled, and active frontend-model transport requests have resolved. Browser/system-test harnesses can call it during teardown before resetting app state.
- Keep request execution centralized in Velocious instead of per-project endpoint overrides.

## Error payloads

### Unexpected errors
- Unexpected frontend-model endpoint failures return `errorMessage: "Request failed."` by default so internal exception details are not exposed to clients.
- `development` and `test` responses also include `debugErrorClass`, `debugErrorMessage`, and `debugBacktrace` for faster browser/system-test diagnosis.
- Other non-production environments, such as `staging`, can opt into the same debug fields with `exposeInternalErrorsToClients: true` on the app `Configuration`.
- `production` always keeps the generic response, even if `exposeInternalErrorsToClients` is set.

### Validation errors
- When a record validation fails during `create` or `update`, the frontend-model response includes structured per-attribute validation errors.
- The response shape is:
  ```json
  {
    "status": "error",
    "errorType": "validation_error",
    "errorMessage": "Name can't be blank",
    "validationErrors": {
      "name": [
        {"type": "presence", "message": "can't be blank", "fullMessage": "Name can't be blank"}
      ]
    }
  }
  ```
- `errorMessage` contains the human-readable joined message.
- `errorType` is `"validation_error"` to distinguish validation failures from unexpected internal errors.
- `validationErrors` is keyed by attribute name; each entry is an array of objects with `type` (validator name), `message` (short description), and `fullMessage` (human-readable error including the attribute label).
- Unlike unexpected errors, validation errors are safe to expose in all environments (including production) because they only carry user-fixable input errors.
- Internal details (stack traces, SQL errors) are never leaked through validation error responses.

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

## Association counts
- `query.withCount("tasks")` attaches a per-row has-many count to each loaded record, read via `record.readCount("tasksCount")`. Accepts a relationship name, an array of names, or an object form with custom attribute names and per-association `where` filters. Polymorphic has-many is supported. See [with-count.md](with-count.md) for full usage and semantics.

## Per-record abilities
- `query.abilities(["update", "destroy"])` (flat form) or `query.abilities({Timelog: ["update"]})` (keyed form) asks the backend to evaluate the current ability against each returned record and attach the results for `record.can(action)` reads. The keyed form also walks preloaded children. See [abilities.md](abilities.md) for full usage and semantics.

## Ransack filtering and sorting
- `ransack(params)` applies Rails-compatible ransack filters and sorting on both frontend and database model queries.
- Supported predicates: `eq`, `notEq`, `in`, `notIn`, `gt`, `gteq`, `lt`, `lteq`, `cont`, `start`, `end`, `null`.
- Keys can be snake_case or camelCase: `nameCont` and `name_cont` are both valid.
- Simple OR predicates can combine attributes in one key: `email_or_reference_cont` matches either attribute.
- Grouped Ransack hashes support `m` (`"and"` / `"or"`), `c` condition arrays, and nested `g` groups. Each condition uses Ransack's compact keys: `a` attributes, `p` predicate, `v` values, and optional per-condition `m`.
- The `s` key applies sorting: `ransack({s: "name asc"})` sorts by name ascending.
- Multiple sort columns can be specified: `ransack({s: "name asc, createdAt desc"})`.
- Relationship paths are resolved automatically: `ransack({projectNameCont: "foo"})` filters through the `project` relationship.
- Translated sort attributes use the translated model's `currentTranslation` relationship so the sort follows the current locale without duplicating records. See [translations.md](translations.md).
- Example combining filter and sort: `User.ransack({emailCont: "john", s: "name asc"}).toArray()`.
- Example grouped search:

  ```js
  const users = await User
    .ransack({
      c: [
        {a: ["email"], p: "cont", v: ["jane"]}
      ],
      g: [
        {
          c: [
            {a: "reference", p: "cont", v: ["user-2"]},
            {a: "email", p: "cont", v: ["john"]}
          ],
          m: "and"
        }
      ],
      m: "or"
    })
    .toArray()
  ```

## Query parity helpers
- `all()` returns a query builder (parity with backend `all()`).
- `order(...)` is available as alias parity with backend `order(...)` (and forwards to frontend sort payloads).
- `first()` and `last()` are available on frontend query/model classes.
- `count()` executes as a backend aggregate, preserving filters, joins, grouping, distinct, and pagination without loading serialized model records.
- `search(path, column, operator, value)` supports both named operators (`gt`, `lt`, `gteq`, `lteq`) and symbolic aliases (`>`, `<`, `>=`, `<=`).
- `defineScope(...)` creates reusable named query scopes. Call `Model.scopeName(args...)` to start a new query, or `query.scope(Model.scopeName.scope(args...))` to apply the same scope to an existing frontend query.
- Frontend scope callbacks receive `{query, modelClass}` plus `table: null` and `driver: null`; frontend scopes should stay descriptor-based (`where`, `joins`, `sort`, etc.) rather than building raw SQL.
- `select({Model: ["attr"]})` narrows the serialized attributes per model (keyed by model name, or root-model shorthand). `selectsExtra({Model: ["attr"]})` keeps the default serialized attributes and loads the listed extras in addition — useful for attributes declared `selectedByDefault: false` on the backend resource.

## Preloading onto loaded records
- `await record.preload(Model.preload({...}).select({...}))` preloads relationship(s) onto a record already in memory, re-fetching the parent through its endpoint and caching the result so later accessors reuse it. Accepts a query or a raw preload spec (`"comments"`, `["comments", {project: true}]`).
- `await Preloader.preload(records, Model.preload({...}))` (from `velocious/build/src/frontend-models/preloader.js`) does the same across an array of records in a single batched request.
- The passed query's `preload`, `select`, `selectsExtra`, `withCount`, `abilities`, and `queryData` are all applied when re-fetching.
- Idempotent: a relationship already preloaded is skipped (no request); when `select`/`selectsExtra` name attributes that are not yet loaded on the cached target, it re-fetches to widen them. Pass `{force: true}` to always re-fetch.

## Nested attributes on `save()`
- Parents can save dirty `hasMany`, `hasOne`, and `belongsTo` relationships in the same request via Rails-style nested-attribute writes. See [nested-attributes.md](nested-attributes.md) for the full feature doc.
- Requires a two-layer opt-in: `Model.acceptsNestedAttributesFor(name, options)` on the backend `Record` subclass (policy: `allowDestroy`, `limit`, `rejectIf`) and an overridden `permittedParams(arg)` method on the resource (flat Rails-style array mixing attribute names with `{<relationshipName>Attributes: [...]}` objects).
- `markForDestruction()` / `markedForDestruction()` on any frontend-model instance flags a loaded child for destruction on the next parent `save()`. To actually destroy, include `"_destroy"` in the nested permit AND set `allowDestroy: true` on the model.
- The `save()` walker includes only dirty children (new / changed / marked-for-destruction / with dirty descendants); loaded-but-untouched children are omitted.
- Rails-style direct keys are supported in normal attributes, for example `Task.create({name: "Design", projectAttributes: {name: "Launch"}})` and `Project.create({name: "Launch", tasksAttributes: [{name: "Design"}]})`.

## Record parity helpers
- `save()` is available for create/update flows (`create` when new record, `update` when persisted). With nested attributes enabled, it also carries dirty children in the same request.
- `create(attributes)` is available on frontend model classes.
- `isNewRecord()`, `isPersisted()`, `changes()`, and `isChanged()` are available on frontend model instances.
- Relationship parity helpers are available via `loadRelationship(name)` / `relationshipOrLoad(name)` / `setRelationship(name, value)` and generated `loadXxx` / `xxxOrLoad` / `setXxx` methods where applicable.
- Has-many relationship helpers support `await model.relationshipName().toArray()` to reuse preloaded data and `await model.relationshipName().load()` to force a refresh.

## React event hooks
- Use `useModelClassEvent(ModelClass, "create" | "update" | "destroy", callback)` to subscribe to frontend-model lifecycle broadcasts from React components.
- Pass an array of event names to subscribe one callback to several class-level events, for example `useModelClassEvent(Subscription, ["create", "update"], reloadStatus)`.
- Convenience wrappers are available as `useCreatedEvent(ModelClass, callback)`, `useUpdatedEvent(ModelClassOrModel, callback)`, and `useDestroyedEvent(ModelClassOrModel, callback)`.
- `useUpdatedEvent` and `useDestroyedEvent` accept a model instance or array of model instances for instance-level subscriptions.
- Hook options support `{active, debounce, onConnected}` plus event record projection options: `select`, `selectsExtra`, `preload`, `withCount`, `abilities`, and `queryData`. The hooks own subscribe/unsubscribe cleanup, so components do not need lifecycle methods just to remove event listeners.
- `onCreate` and `onUpdate` can receive a frontend-model query instead of a plain options object. React hooks can receive the same query through the `query` option. The query's `where`, `joins`, and `search` predicates narrow which create/update events reach that callback. The same query's `select`, `selectsExtra`, `preload`, `withCount`, `abilities`, and `queryData` control the event payload.
- Event queries intentionally reject list-only options such as `limit`, `offset`, `page`, `perPage`, `sort`, `group`, and `distinct` because lifecycle events match one saved record at a time.
- Destroy events carry only ids after the row is gone, so query-filtered destroy subscriptions are not supported. Use an unfiltered destroy listener and check local ids when a screen needs deletion cleanup.

```js
useUpdatedEvent(
  BuildGroup,
  onBuildGroupUpdated,
  {
    query: BuildGroup
      .where({projectId})
      .select({BuildGroup: ["id", "status", "rebuildableBuildsCount"]})
      .withCount("builds")
  }
)
```

## Attachment support
- Frontend models can define `resourceConfig().attachments` and use generated attachment handles:
  - `await model.attachmentName().attach(fileLikeOrBase64Payload)`
  - `const attachment = await model.attachmentName().download()`
  - `const attachmentUrl = await model.attachmentName().url()`
- Backend attachment command mapping supports `attach`, `download`, and `url` command names in resource `commands`.
- Frontend attachment input supports `File`/`Blob` (`arrayBuffer()`), bytes, and `{contentBase64, filename?, contentType?}` payloads.
- Frontend attachment input does not support `{path: ...}`.
- Setting an attachment field in `create`, `update`, or `save()` queues it into that model's mutation payload. Nested attributes can include attachment fields when the nested permit lists that attachment name.

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
