# Consumer-defined per-row values — `.queryData(...)`

`.queryData(spec)` lets the consumer wire arbitrary SQL aggregations,
computed columns, or correlated subqueries onto every loaded root
record — without writing a custom controller endpoint or hand-rolling
a second query. Like `.withCount(...)`, results live on a dedicated
map (not on `_attributes`), so a virtual value cannot shadow a real
column of the same name. Values are read back with
`record.queryData(aliasName)`.

Available on both `ModelClassQuery` (backend) and
`FrontendModelQuery` (frontend); the API is identical.

## Register a fn on the backend model

Consumers declare queryData entries per model class. Each fn receives
a pre-built grouped query and adds its own SELECT (and optionally
joins/where). The fn is invoked once per entry, per `.queryData(...)`
call.

```js
Project.queryData("manualTasksCount", ({driver, query}) => {
  query.joins({tasks: true})
  const tasksTable = driver.quoteTable(query.tableNameFor("tasks"))
  query.select(`COUNT(${tasksTable}.${driver.quoteColumn("id")}) AS manualTasksCount`)
})

Project.queryData("projectStats", ({driver, query}) => {
  query.joins({tasks: true})
  const tasksTable = driver.quoteTable(query.tableNameFor("tasks"))
  const idCol = driver.quoteColumn("id")
  query.select(`COUNT(${tasksTable}.${idCol}) AS taskCount`)
  query.select(`MIN(${tasksTable}.${idCol}) AS minTaskId`)
})
```

A single registration can select multiple aliased columns; every
alias the fn selects becomes a separate `queryData(...)` key on the
root record. The registration name is purely an identifier used by
the spec; it does not need to match any alias.

### Callback arguments

The fn receives:

- **`query`** — a grouped query over the root model, already joined
  down the chain and already filtered to the loaded parent PKs.
  `parent_id` is pre-selected, and `GROUP BY` is pre-applied.
- **`tableName`** — unquoted table reference (alias or table name)
  for the entry's target model (the class the fn is registered on).
- **`attributeName`** — the fn's registration name.
- **`driver`** — active database driver, for `quoteTable` / `quoteColumn`.
- **`modelClass`** — the entry's target model class.
- **`parentIds`** — the loaded root primary-key values.

## Request a fn in a query

Pass a name, array, or nested-record spec to `.queryData(...)`. Nested
keys are relationship names along the join chain from the root to the
declaring model; leaf strings are registered fn names at that level.
**Results always attach to the root record**, regardless of how deeply
the spec nests.

```js
const [project] = await Project
  .where({id: projectId})
  .queryData("manualTasksCount")
  .toArray()

project.queryData("manualTasksCount") // → 3
```

Nested chain — register the fn on the chain's target and point the
spec at it:

```js
Task.queryData("taskAggregates", ({driver, query, tableName}) => {
  const tasks = driver.quoteTable(tableName)
  const id = driver.quoteColumn("id")
  query.select(`COUNT(${tasks}.${id}) AS taskAggregateCount`)
  query.select(`MAX(${tasks}.${id}) AS taskAggregateMaxId`)
})

const [project] = await Project
  .where({id: projectId})
  .queryData({tasks: ["taskAggregates"]})
  .toArray()

project.queryData("taskAggregateCount")  // → on the Project root
project.queryData("taskAggregateMaxId")  // → on the Project root
```

## How it runs

For each leaf entry the runner:

1. Walks the relationship chain from the root model to find the
   target model class and its registered fn. Unknown names raise a
   clear error naming the missing registration.
2. Starts a fresh query on the root model class, applies `WHERE
   root.pk IN (<loaded parent PKs>)` and `LEFT JOIN`s down the
   chain, groups by the root primary key, and pre-selects it as
   `parent_id`.
3. Invokes the registered fn so it can add its own SELECTs / joins.
4. Executes the query and maps each row's non-`parent_id` columns
   onto the matching root record via `record._setQueryData(alias, value)`.
5. Records without a matching row (or rows where an aggregate
   returned NULL, e.g. `SUM(...)` over zero child rows) keep
   `record.queryData(alias) === null`.

One grouped query runs per entry. Entries are independent — the
runner makes no attempt to merge selects across different fns.

## Interaction with other query methods

- `.count()` on the parent query is unaffected — it does not execute
  any queryData fns.
- `.queryData(...)` composes with `.page(n).perPage(pp)`, `.where(...)`,
  `.ransack(...)`, `.joins(...)`, `.withCount(...)`, etc. Each
  aggregate query is scoped to the parent primary keys actually
  loaded for the current page, not the whole table.
- A fn can freely call `query.joins(...)` (relationship-object form)
  and `query.tableNameFor(relationshipName)` to reference joined
  tables. For root-level registrations these resolve from the root
  model. For nested-chain registrations, the root base path is kept
  at `[]` so joins resolve relative to the root — use full paths
  (`{projects: {tasks: true}}`) to join further.

## Wire format (frontend → backend)

`FrontendModelQuery#queryData(spec)` ships the spec verbatim under a
`queryData` key on the `index` command payload:

```json
{"queryData": {"tasks": ["taskAggregates"]}}
```

**The payload carries only names and nested-relationship keys.** SQL
fragments never cross the wire — they live on the backend as
`Model.queryData(name, fn)` registrations. Any name the spec references
that isn't registered on its resolved target model raises an error
server-side.

The frontend-model controller picks the payload up in
`frontendModelQueryData()` and re-applies `.queryData(...)` on the
authorized scope inside `frontendModelIndexQuery()`. Each serialized
record includes queryData values on a dedicated `__queryData` key
alongside `__associationCounts` / `__preloadedRelationships`, and
`FrontendModelBase#instantiateFromResponse` hydrates them into the
record's `_queryDataValues` map.

## Security

Because SQL lives entirely on the backend and the frontend only names
which registrations to execute, `.queryData(...)` exposes no SQL
surface to clients. A registered fn runs inside the already-authorized
frontend-model scope; since the inner aggregate query starts from the
loaded root PKs, queryData cannot widen record visibility — it only
reports over rows already permitted.
