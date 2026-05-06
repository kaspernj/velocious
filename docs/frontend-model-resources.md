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
- Resources that override `records()` opt out of aggregate `count()` automatically because Velocious cannot infer whether the default query still matches the custom records.
- Override `count()` on the resource when a custom index needs frontend-model `count()` support.

## Naming conventions
- Resource files should use concise domain naming (for example `battle.js`, `challenge-level.js`) instead of frontend-specific suffixes.
- Frontend imports should use model names without `FrontendModel` suffix (for example `Account`, not `AccountFrontendModel`).

## Project boundary
- Backend projects should keep the recipe in `backend/src/resources`.
- Generated frontend model code should live in the configured frontend output path.
- Avoid duplicating hand-maintained frontend-model code under backend.

## Nested-attribute writes
- Resources opt in to nested writes by overriding `permittedParams(arg)` to return a Rails-style flat array mixing attribute-name strings with `{<relationshipName>Attributes: [...]}` objects.
- Model-level `Model.acceptsNestedAttributesFor(name, options)` is **required** in addition to the resource declaration. Policy options like `allowDestroy`/`limit`/`rejectIf` live on the model, not in the permit array.
- `permittedParams(arg)` is **strict by default** — the default returns `[]`, permitting nothing. Submitting an attribute or nested key that is not in the permit raises an error.
- Include `"_destroy"` inside a nested permit to allow `{_destroy: true}` entries for that relationship; the model must also declare `allowDestroy: true`.
- Nested children are authorized against their own resource's abilities, not the parent's. Full doc: [nested-attributes.md](nested-attributes.md).
