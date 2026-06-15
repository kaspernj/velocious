# Frontend Model Resources

## Resource recipe requirement
Frontend model usage should require explicit backend resource recipes.

A backend project should declare resources with:
- `path`
- `attributes`
- `abilities`
- optional `commands`
- optional `attachments`
- optional server behavior (`records`, `serialize`, `beforeAction`)

Without a resource definition, frontend models should not silently work.

## Attachment command mapping
- Resource `commands` can map `attach`, `download`, and `url` in addition to CRUD/index commands.
- Resource `attachments` defines attachment helpers generated on frontend models.

## Custom index records
- Override `indexQuery(options)` when the default index behavior is correct but the resource needs an additional scope. Call `super.indexQuery(options)` and add the resource-specific filters, joins, or select data. The `options` object can include `includePagination` and `includeSort`; the built-in aggregate `count()` disables both so it counts the full filtered scope.
- Override `applyFrontendModelIndexPagination({controller, pagination, query})`, `applyFrontendModelIndexSearch({controller, query, search})`, or `applyFrontendModelIndexSort({controller, query, sort})` when only one part of the default index query needs resource-specific behavior. Delegate back to the controller method for the default behavior, for example `controller.applyFrontendModelSearch({query, search})`.
- Resources that override `records()` opt out of aggregate `count()` automatically because Velocious cannot infer whether the default query still matches the custom records.
- Override `count()` on the resource when a custom index needs frontend-model `count()` support.

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
- `permittedParams(arg)` is **strict by default** — the default returns `[]`, permitting nothing. Submitting an attribute or nested key that is not in the permit raises an error.
- Include `"_destroy"` inside a nested permit to allow `{_destroy: true}` entries for that relationship; the model must also declare `allowDestroy: true`.
- Include attachment names in the permit when nested entries should attach files, for example `{tasksAttributes: ["name", "descriptionFile"]}`.
- `belongsTo` nested attributes are saved before the parent so the parent foreign key can be assigned. `hasOne` and `hasMany` nested attributes are saved after the parent.
- Nested children are authorized against their own resource's abilities, not the parent's. Full doc: [nested-attributes.md](nested-attributes.md).
