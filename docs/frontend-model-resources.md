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

## Naming conventions
- Resource files should use concise domain naming (for example `battle.js`, `challenge-level.js`) instead of frontend-specific suffixes.
- Frontend imports should use model names without `FrontendModel` suffix (for example `Account`, not `AccountFrontendModel`).

## Project boundary
- Backend projects should keep the recipe in `backend/src/resources`.
- Generated frontend model code should live in the configured frontend output path.
- Avoid duplicating hand-maintained frontend-model code under backend.

## Nested-attribute writes
- Resources opt in to nested writes by overriding the `nestedAttributes(arg)` instance method (or the broader `permittedParams(arg)` hook) to return per-relationship policy `{allowDestroy?, limit?, rejectIf?}`.
- Model-level `Model.acceptsNestedAttributesFor(name, options)` is **required** in addition to the resource declaration. Without it, nested writes are rejected regardless of resource configuration.
- `permittedParams(arg)` returns `{attributes: string[], nestedAttributes: Record<string, policy>}` and is **strict by default** — submitting an attribute (nested or not) that is not in the permit raises an error. The default implementation reads `static attributes` minus the conventional auto-managed columns (`id`, `createdAt`, `updatedAt`).
- Nested children are authorized against their own resource's abilities, not the parent's. Full doc: [nested-attributes.md](nested-attributes.md).
