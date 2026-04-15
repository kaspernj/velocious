# Nested Attributes

Velocious supports Rails-style nested-attribute writes on frontend-model `save()`. A parent record can carry dirty `hasMany` children in a single HTTP round-trip with full **create / update / destroy** semantics, per-child authorization, and a single DB transaction around the whole cascade.

A nested write has to pass two independent gates before it is applied. This is deliberate — the model decides what it structurally accepts, and the resource decides what the current request is allowed to touch.

## Quick example

```js
// Backend model — Rails-style opt-in on the Record subclass
class Project extends Record {}
Project.hasMany("tasks")
Project.acceptsNestedAttributesFor("tasks", {allowDestroy: true, limit: 100})

class Task extends Record {}
Task.belongsTo("project")

// Backend frontend-model resource — declares what the resource exposes
class ProjectResource extends FrontendModelBaseResource {
  static attributes = ["id", "name"]
  static relationships = ["tasks"]

  /** @returns {Array<string | Record<string, any>>} */
  permittedParams() {
    return [
      "name",
      {tasksAttributes: ["id", "_destroy", "name"]}
    ]
  }
}

class TaskResource extends FrontendModelBaseResource {
  static attributes = ["id", "projectId", "name", "completed"]
}

// Frontend-model usage
const project = await Project.preload(["tasks"]).find(id)

project.setName("Launch v2")

for (const task of project.tasksLoaded()) {
  if (task.obsolete) task.markForDestruction()
}

const newTask = project.tasks().build({name: "New task"})

await project.save()
// → single request, creates newTask, destroys the obsolete ones, updates the parent
```

## Two-layer opt-in

### 1. Model — `acceptsNestedAttributesFor` (Rails-style)

Declared on the backend `Record` subclass. Required. The backend throws if a payload references a relationship the model has not opted in, regardless of what any resource permits.

```js
Project.acceptsNestedAttributesFor("tasks", {
  allowDestroy: true,  // whether `_destroy: true` entries are accepted
  limit: 100           // maximum nested entries per request
})
```

`Project.acceptedNestedAttributesFor("tasks")` returns the policy (or `null`). Acceptance declarations do not leak between sibling classes — each model class owns its own.

Resource-level policy can **restrict** but never **loosen** what the model declared. If the model does not declare `allowDestroy`, no resource can enable destroys for that relationship.

### 2. Resource — `permittedParams(arg)`

Declared as an instance method on the frontend-model resource class. Returns a Rails/api_maker-style **flat array** that mixes attribute-name strings with `{<relationshipName>Attributes: [...]}` objects for nested permits:

```js
class ProjectResource extends FrontendModelBaseResource {
  /** @param {{action?: string, ability, locals}} [arg] */
  permittedParams(arg) {
    return [
      "name",
      "description",
      {tasksAttributes: ["id", "_destroy", "name",
        {subtasksAttributes: ["id", "_destroy", "name"]}
      ]}
    ]
  }
}
```

This matches Ruby on Rails strong_params (`permit(:first_name, :last_name, contact_attributes: [:email, details_attributes: [:detail]])`) and the api_maker sister project.

**Strict by default.** Submitting an attribute or nested-relationship key that is not in the permit raises an error and fails the write. There is no silent drop. The default implementation returns `[]` — nothing is permitted. A resource that doesn't override `permittedParams` cannot accept any write.

**Policy options** (`allowDestroy`, `limit`, `rejectIf`) live on the **model** side via `acceptsNestedAttributesFor`. The permit array only lists which attributes and nested relationships are writable. To allow destroys for a relationship, include `"_destroy"` in its nested permit **and** set `allowDestroy: true` on the model's `acceptsNestedAttributesFor`.

**Deeper nesting** lives inline in the parent's permit (Rails-style): `{tasksAttributes: ["id", "name", {subtasksAttributes: ["id"]}]}`. The parent's permit governs what attributes can be written on nested children; child-resource `permittedParams` only applies to direct writes on that child.

**Request-aware permits** are straightforward because `permittedParams(arg)` is a method with access to `arg.action`, `arg.ability`, `arg.locals`. For example:

```js
permittedParams(arg) {
  const attrs = ["name", "description"]

  if (arg?.locals?.isAdmin) attrs.push("internalNotes")

  return [...attrs, {tasksAttributes: ["id", "_destroy", "name"]}]
}
```

## Wire payload

```json
{
  "attributes": {"name": "Launch v2"},
  "nestedAttributes": {
    "tasks": [
      {"id": 7, "_destroy": true},
      {"id": 8, "attributes": {"name": "renamed"}},
      {"attributes": {"name": "brand new"},
       "nestedAttributes": {
         "subtasks": [{"attributes": {"name": "a subtask"}}]
       }}
    ]
  }
}
```

Entry shape:

- **Destroy**: `{id: existingId, _destroy: true}`. Requires `allowDestroy: true` on both model and resource.
- **Update**: `{id: existingId, attributes: {...}, nestedAttributes?: {...}}`. Attributes are optional if only descendants changed.
- **Create**: `{attributes: {...}, nestedAttributes?: {...}}`. No `id`.

Children not referenced in the payload are left alone — Rails-default "replace only what you sent" semantics.

## Client API

### `markForDestruction()`

Queues a loaded child for destruction on the next parent `save()`. Pure client-side flag; no network call until the parent saves.

```js
const task = project.tasksLoaded().find((t) => t.name() === "old")
task.markForDestruction()
// task.markedForDestruction() === true
await project.save()   // sends {id: task.id(), _destroy: true} as a nested entry
```

### `save()` walker

`FrontendModelBase.save()` walks `this.constructor.resourceConfig().nestedAttributes` and collects:

- new records (`child.isNewRecord()`)
- records marked with `markForDestruction()`
- records with changed attributes (`child.isChanged()`)
- records with dirty descendants in their own `nestedAttributes`

Loaded-but-untouched children are omitted from the payload. Nothing is sent for relationships the resource didn't opt in, even when children were loaded.

### Post-save reconciliation

The server response includes preloaded versions of the affected relationships. The client applies them over the local in-memory graph, so:

- new children gain their server-assigned ids and flip to `isPersisted()`
- destroyed children are dropped from the parent's loaded array
- existing references to pre-save child instances may go stale — re-read via `parent.relationshipName().loaded()` (or the generated `parentRelationshipLoaded()`) after save if you need the current view

## Backend cascade

`FrontendModelBaseResource.create()` and `update()` wrap the whole cascade in `ModelClass.transaction(...)`. Inside the transaction, `_applyNestedAttributes` processes each relationship in the order **destroy → update → create** — this avoids unique-constraint conflicts when replacing a child at the same natural key.

For each nested entry:

1. **Model gate** — throws if the parent model hasn't declared `acceptsNestedAttributesFor` for the relationship.
2. **Resource gate** — throws if the parent's permit spec doesn't include the relationship.
3. **Non-hasMany guard** — throws for `belongsTo` / `hasOne` / polymorphic / through (out of scope for v1).
4. **Lookup** (updates and destroys only): queries the **child model class** directly (never through the parent controller's scoping), filters by `{[primaryKey]: entry.id, [foreignKey]: parent.id()}`, and applies the child resource's own ability mapping for the requested action. Missing-or-foreign-parent-or-not-authorized collapses to a single clear error that rolls the transaction back.
5. **Authorization**: always via the **child resource's** own `abilities` mapping — never the parent's. Custom mappings like `{update: "manage"}` are honored.
6. **Attribute filtering**: runs through the child resource's own `permittedParams(arg)` so the parent doesn't have to know what the child allows.
7. **Recursion**: if the entry has its own `nestedAttributes`, recurse into the child resource's `_applyNestedAttributes`.

If any step in the cascade fails — unauthorized child, unknown key, nested validation — the whole transaction rolls back. The parent is left unchanged and no children are created or destroyed.

## Migration from bespoke `/save-all` endpoints

Before nested attributes, the idiomatic way to update a parent with children was a custom controller endpoint that took a bespoke envelope. Migration is:

1. Declare `acceptsNestedAttributesFor` on each parent model.
2. Declare `nestedAttributes` (or `permittedParams`) on each resource.
3. Replace the client-side custom POST with `model.save()` after mutating children via `build(...)` and `markForDestruction()`.
4. Delete the bespoke controller action.

## Limitations (v1)

- `hasMany` only. `hasOne` and `belongsTo` nested writes are not yet supported — the ordering story differs and needs its own design.
- Polymorphic and `through` relationships are not supported for nested writes. They throw with a clear message.
- No built-in server-side `limit` enforcement beyond the optional policy `limit` and client payload size.
- The client's post-save reconciliation replaces the relationship array with the server's authoritative set; any external references you held to the pre-save child instances can go stale.

## See also

- [Relationships](relationships.md) — `hasMany` / `belongsTo` / `hasOne` and `through`.
- [Frontend models](frontend-models.md) — save/update/destroy, relationship helpers, `build(...)`.
- [Frontend model resources](frontend-model-resources.md) — abilities, attributes, attachment commands.
- [Authorization and current](authorization-and-current.md) — ability setup used by the nested-authorization path.
