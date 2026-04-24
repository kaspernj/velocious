# Per-record ability checks — `.abilities(...)` + `record.can(...)`

`query.abilities(spec)` tells the backend to evaluate one or more
ability actions against each returned record and ship the results
back so UI code can read them via `record.can(action)`. Read-side
only: backend enforcement on the actual `update` / `destroy` /
`create` commands is unchanged (the existing
`abilities.update` / `abilities.destroy` / etc. in the resource
config still guard every mutation).

## Shapes

Flat form — actions apply to the query's own model class:

```js
const timelogs = await Timelog
  .where({taskId})
  .abilities(["update", "destroy"])
  .toArray()

if (timelogs[0].can("update")) {
  // ...render the edit button
}
```

Keyed form — targets records by model name. Useful for preloaded
children at any depth:

```js
const project = await Project
  .preload({timelogs: true})
  .abilities({Timelog: ["update", "destroy"]})
  .first()

const firstTimelog = project.timelogs().loaded()[0]
firstTimelog.can("update") // → boolean
```

Keys in the keyed form are backend model names (as returned by
`ModelClass.getModelName()` or the `modelName` field of the
frontend-model resource config). Values are the ability-action
strings — typically `"update"` / `"destroy"` / `"create"` /
`"read"`, but any custom action registered on the resource's
authorization ability is accepted.

## How it runs

After the main query loads its rows and applies preloads, the
controller walks the loaded cohort and, for each
`(modelClass, action)` pair in the spec, runs one batched
`ModelClass.accessibleFor(action).where({id: IN (...loadedIds)}).pluck("id")`
query. Each record's ability result lands on a dedicated
`_computedAbilities` map and rides back on the wire as
`__abilities: {update: true, destroy: false}` alongside the record's
attributes. The frontend hydrates these into a per-record map that
`record.can(action)` reads from.

Defaults and edge cases:

- `record.can(action)` returns `false` for actions that weren't
  requested — so UI branches don't need to guard against unloaded
  values.
- An ability with no allow rules for the requested action on the
  target model class returns `false` for every record, rather than
  propagating the `accessibleFor` error to the UI.
- Records that are filtered out by the base `read` ability never
  reach the abilities evaluator (the authorized index query drops
  them first). `.abilities(...)` only annotates records that are
  already readable.

## Interaction with other query methods

- Combines cleanly with `.where(...)` / `.ransack(...)` /
  `.preload(...)` / `.page(n).perPage(pp)` / `.withCount(...)` /
  `.queryData(...)`. Each of those contributes its own payload
  piece; the `abilities` key is additive.
- `.find(id)` and `.findBy(conditions)` both carry the abilities
  payload, so the `__abilities` attachment works for single-record
  reads too.
- `.count()` is unaffected — ability results don't change the row
  count.

## Wire format

`FrontendModelQuery#abilities(spec)` normalizes the spec into an
array of `{modelName, actions}` entries and sends them as the
`abilities` key of the `index` / `find` command payload. The
backend controller's `frontendModelAbilities()` parser reads them
back out, `_frontendModelClassForAbilities(modelName)` resolves
the model class via the configured `backendProjects[].frontendModels`
registry, and `frontendModelComputeAbilities` attaches the results
to the loaded records before serialization.
