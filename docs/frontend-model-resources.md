# Frontend Model Resources

## Resource recipe requirement
Frontend model usage should require explicit backend resource recipes.

A backend project should declare resources with static resource properties:
- `static attributes`
- optional `abilities` for additional per-record `record.can(action)` checks
- optional `commands`
- optional `attachments`
- optional server behavior (`records`, `serialize`, `beforeAction`)

Backend resource classes must not override `static resourceConfig()`; Velocious throws during resource normalization. Use declarative static fields instead so resource config stays easy to scan and shared-resource fallback has one config path.

Base CRUD ability actions (`read`, `create`, `update`, `destroy`) are always included by the framework; do not list them in `abilities` or Velocious throws during resource normalization.

Without a resource definition, frontend models should not silently work.

## Attachment command mapping
- Resource `commands` can map `attach`, `download`, and `url` in addition to CRUD/index commands.
- Resource `attachments` defines attachment helpers generated on frontend models.

## Shared resource fallback
- Environment-specific resources may declare `static SharedResource = SharedModelResource` to reuse a bundled shared resource recipe.
- Static frontend-model config resolves in this order: environment resource value, inherited environment resource value, shared resource value, framework default.
- Default instance methods such as `permittedParams`, normalization hooks, mutation hooks, `runMutationTransaction`, `beforeAction`, and `abilities` fall back to the shared resource only when the environment resource does not override the method.
- Custom resource methods such as collection/member commands, computed `${name}Attribute` hooks, and virtual setters can live on the shared resource when their config is inherited from it.
- Shared `abilities()` runs with the environment resource's model class, so helpers such as `this.can("read")` authorize the concrete backend model.
- Shared resources should resolve portable model classes through `this.model("Task")` instead of importing backend-only files directly. The resource context can provide `modelRegistry`, `model(name)`, or a backend `configuration` model map.
- Portable context helpers available to shared resources include `currentUser()`, `currentDevice()`, `offlineGrant()`, `now()`, `resourceRuntime()`, `isBackend()`, `isFrontend()`, and `isOffline()`.
- Shared resources should treat `this.model(...)`, query APIs, and context helpers as the portability boundary. Avoid raw SQL, Node-only imports, secrets, direct database driver access, or environment-specific globals in shared resource files.
- Treat shared resources as reusable defaults, not a security boundary. Environment resources should still override attributes, permissions, commands, or hooks whenever a frontend/backend deployment needs narrower behavior.

## Sync policy metadata
- Resources that participate in local/offline sync may declare `static sync` with safe metadata:

  ```js
  static sync = {
    operations: ["index", "find", "update", "scanTicket"],
    policyVersion: "scanner-v1",
    metadata: {scope: "event"},
    policy: {grantScopeAttributes: ["eventId"], writableAttributes: ["scanState"]}
  }
  ```

- `metadata` is copied into generated frontend-model `resourceConfig().sync` and the sync manifest. Keep it frontend-safe: no secrets, tokens, private keys, raw SQL, backend file paths, driver config, or environment-specific values.
- `policy` is not copied into generated frontend config. It is deterministic JSON included in `policyHash` so clients and peers can detect that their bundled resource policy no longer matches the backend policy.
- `policyHash` is a `sha256-...` hash over deterministic sync inputs (`operations`, `policyVersion`, safe `metadata`, and `policy`). Bump `policyVersion` whenever shared resource policy changes in a way that should invalidate offline grants or peer-applied mutations.
- Sync config accepts deterministic JSON only. Functions, classes, Dates, Maps, Sets, and secret-looking keys such as `privateKey`, `token`, `password`, or `secret` are rejected during resource normalization.

## Custom index records
- Override `indexQuery(options)` when the default index behavior is correct but the resource needs an additional scope. Call `super.indexQuery(options)` and add the resource-specific filters, joins, or select data. The `options` object can include `includePagination` and `includeSort`.
- Override `countIndexQueryOptions()` when a resource-specific `count()` needs different index-query options, for example `{includePagination: false, includeSort: false}` to count the full filtered scope while keeping paginated records.
- Override `applyFrontendModelIndexPagination({controller, pagination, query})`, `applyFrontendModelIndexSearch({controller, query, search})`, or `applyFrontendModelIndexSort({controller, query, sort})` when only one part of the default index query needs resource-specific behavior. Delegate back to the controller method for the default behavior, for example `controller.applyFrontendModelSearch({query, search})`.
- Resources that override `records()` opt out of aggregate `count()` automatically because Velocious cannot infer whether the default query still matches the custom records.
- Override `count()` on the resource when a custom index needs frontend-model `count()` support.

## Custom commands
- Declare custom commands on the resource with `collectionCommands` (class-level, e.g. `Model.refreshAll()`) and `memberCommands` (instance-level, e.g. `record.refresh()`), as arrays. The generator emits a method per command and the runtime derives each command's kebab-case route slug from the camelCase method name.
- Each array entry is **either** a plain camelCase method-name string **or** a `{name, args?, returnType?}` object that also declares the command's contract:
  - `args` is an array of `{name, type}` objects. Each becomes a named, typed method parameter, mapped positionally into the command payload. `type` is a JSDoc type string (for example `"number"`, `"string | null"`).
  - `returnType` is a JSDoc type string for the command response. When set, the generated method is typed `Promise<returnType>` instead of the generic `Promise<Record<string, FrontendModelAttributeValue>>` (a command result is a deserialized transport payload, so its values are `FrontendModelAttributeValue` — the closed transport-value union). The type is emitted verbatim into the generated frontend model, so it must resolve there (a self-contained inline type or a name the model can import).
- Both forms can be mixed in the same array; string entries are unchanged and stay variadic (`async refresh(...commandArguments)`).

```js
static attributes = ["id"]

static memberCommands = [
  "suspend",
  {name: "refresh", args: [{name: "age", type: "number"}], returnType: "string"}
]
```

generates, on the frontend model:

```js
/** @returns {Promise<Record<string, FrontendModelAttributeValue>>} - Command response. */
async suspend(...commandArguments) { /* ... */ }

/**
 * @param {number} age - Command argument.
 * @returns {Promise<string>} - Command response.
 */
async refresh(age) { /* ... */ }
```

### Deriving a command's types from the resource method JSDoc
- When a command is declared as a plain string (no explicit `{args, returnType}`), the generator derives its typed signature from the **backend resource method's own `@param`/`@returns` JSDoc**, so the type is declared once on the method and flows to the generated frontend method.
- The command runner passes the deserialized command payload as the method's **first argument**, so a method can take a single typed args object and document it with one `@param`:

  ```js
  /**
   * @param {{accountId: string, token: string}} args - Create-card arguments.
   * @returns {Promise<{billingCard: BillingCard, status: "ok"}>} - Create-card response.
   */
  async createCard(args) { /* reads args.accountId, args.token */ }
  ```

  generates `static async createCard(args)` typed `(args: {accountId: string, token: string}) => Promise<{billingCard: any, status: "ok"}>`. `this.params()` is unchanged, so existing parameterless methods keep working. The args object is **untrusted client input** typed only by the declared contract — methods must still validate the values they read.
- **Precedence:** an explicit `resourceConfig` `{args, returnType}` wins, then the derived backend-method JSDoc, then the generic default (`...commandArguments` + `Promise<Record<string, FrontendModelAttributeValue>>`).
- **Shared DTO imports are preserved.** If the resource file has `/** @import {MyCommandResponse} from "../../../shared/my-command-types.js" */` and the command returns `Promise<MyCommandResponse>`, the generated frontend model rewrites that to an equivalent relative `import("...").MyCommandResponse` from the generated model file. The imported file must live outside the backend `src` tree so it is resolvable by the frontend build.
- **Model results downgrade to `any`.** A derived type referencing a model class (`BillingCard`, `Account`, …) or a backend-local `import("...")` type is rewritten field-by-field to `any`, because the frontend receives a *serialized* record, not a model instance — sibling scalar fields keep their real types. Hydrate a downgraded field with `Model.instantiateFromResponse(response.field)`. (Keep result-object string literals lower-case, e.g. `status: "ok"`; an upper-case literal would be misread as a model identifier and downgraded.)
- **Backend-local helper types are rejected.** Do not return `ReturnType<typeof serializePayload>` or similar helper-derived types from a resource command method. Move reusable command response shapes to a shared typedef file and return that named type so the generated frontend model receives the real public contract.
- **All-optional args are omittable.** When the `args` object literal has only optional fields (so `{}` satisfies it), the generated method defaults the parameter (`async rawContainers(args = {})`), so callers can omit it entirely (`record.rawContainers()` instead of `record.rawContainers({})`). A command with any required field — or any non-object-literal arg type (a positional primitive, a `Record<...>` / `Partial<...>` wrapper, or an intersection) — conservatively keeps the mandatory parameter.

## Naming conventions
- Resource files should use concise domain naming (for example `battle.js`, `challenge-level.js`) instead of frontend-specific suffixes.
- Frontend imports should use model names without `FrontendModel` suffix (for example `Account`, not `AccountFrontendModel`).

## Project boundary
- Backend projects should keep the recipe in `backend/src/resources`.
- Generated frontend model code should live in the configured frontend output path.
- Avoid duplicating hand-maintained frontend-model code under backend.

## Generated attribute types
- The frontend-model generator scans each configured backend project's `src` tree when reading resource and model accessor JSDoc.
- Translated resource attributes use their translation table column metadata when a resource method or generated accessor JSDoc is not available.
- Resource attribute methods such as `statusCodeAttribute(model)` should carry an `@returns` tag when their serialized value differs from the backing column.
- Resource attribute return types take precedence over backend model columns, because frontend payloads serialize the resource method result.
- Async resource attribute methods are typed from their resolved value, so `@returns {Promise<string | null>}` generates `string | null`.

## Nested-attribute writes
- Resources opt in to nested writes by overriding `permittedParams(arg)` to return a Rails-style flat array mixing attribute-name strings with `{<relationshipName>Attributes: [...]}` objects.
- Model-level `Model.acceptsNestedAttributesFor(name, options)` is **required** in addition to the resource declaration. Policy options like `allowDestroy`/`limit`/`rejectIf` live on the model, not in the permit array.
- `permittedParams(arg)` is **strict by default** — the default returns `[]`, permitting nothing. Submitting an attribute or nested key that is not in the permit returns a client-safe error with `velocious.code: "frontend-model-attribute-error"`, including the rejected attribute names.
- Include `"_destroy"` inside a nested permit to allow `{_destroy: true}` entries for that relationship; the model must also declare `allowDestroy: true`.
- Include attachment names in the permit when nested entries should attach files, for example `{tasksAttributes: ["name", "descriptionFile"]}`.
- `belongsTo` nested attributes are saved before the parent so the parent foreign key can be assigned. `hasOne` and `hasMany` nested attributes are saved after the parent.
- Nested children are authorized against their own resource's abilities, not the parent's. Full doc: [nested-attributes.md](nested-attributes.md).
