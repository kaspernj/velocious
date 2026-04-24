# Association counts — `.withCount(...)`

`.withCount(spec)` tells a query to fetch per-row counts of a
has-many association alongside the main query, without issuing a
per-row round-trip. Each loaded record exposes the result through a
dedicated `readCount(attributeName)` helper — counts live on their
own map, separate from the record's attributes, so a virtual count
cannot silently shadow a real column of the same name (e.g. a
`tasksCount` counter-cache column).

Available on both `ModelClassQuery` (backend) and
`FrontendModelQuery` (frontend); the API is identical.

## Shapes

Shorthand: a single relationship name.

```js
const organizations = await Organization
  .withCount("projects")
  .toArray()

organizations[0].readCount("projectsCount") // → 12
```

Array shorthand: several relationships at once.

```js
const tasks = await Task
  .withCount(["timelogs", "comments"])
  .toArray()

tasks[0].readCount("timelogsCount") // → 3
tasks[0].readCount("commentsCount") // → 7
```

Object form: custom attribute names and/or per-association filtering.

```js
const organizations = await Organization
  .withCount({
    projects: true,
    activeMembersCount: {relationship: "users", where: {active: true}}
  })
  .toArray()

organizations[0].readCount("projectsCount")       // → 12
organizations[0].readCount("activeMembersCount")  // → 3
```

Keys in the object form become the attribute name as-is. `true` is
shorthand for "count this relationship, store under `<name>Count`";
`{relationship, where}` lets you rename, filter, or both.

## How it runs

After the main query's rows come back, Velocious issues one grouped
count query per requested association:

```sql
SELECT foo_id AS parent_id, COUNT(*) AS count_value
FROM foos
WHERE foo_id IN (<loaded parent PKs>)
  [AND <your where clause>]
  [AND <polymorphic type column> = '<parent model name>']
GROUP BY foo_id
```

Counts attach to each parent record's `_associationCounts` map via
`record._setAssociationCount(attributeName, value)`. Reads go through
`record.readCount(attributeName)`, which returns `0` when the query
didn't request that count.

## Interaction with other query methods

- `.count()` on the parent query is unaffected — it still returns
  the parent row count and doesn't include any of the
  `.withCount(...)` output.
- `.withCount(...)` is safe to combine with `.page(n).perPage(pp)`,
  `.where(...)`, `.ransack(...)`, `.joins(...)`, etc. Each grouped
  count query is scoped to the parent primary keys actually loaded
  for the current page, not the full table.
- Counter-cache columns (e.g. a real `tasks_count` column populated
  by `belongsTo("project", {counterCache: true})`) still live on
  `_attributes` and are read via `readAttribute`. `readCount(...)`
  only surfaces values attached by `.withCount(...)`. The two never
  overwrite each other.

## Supported associations

- `hasMany` — fully supported, including polymorphic has-many (the
  polymorphic type column is added to the grouped count query's
  `WHERE`).
- `hasOne`, `belongsTo`, `hasMany :through` — not supported yet.
  `.withCount(...)` will throw when given one of these.

## Wire format (frontend → backend)

`FrontendModelQuery#withCount(spec)` normalizes the spec into an
array of `{attributeName, relationshipName, where?}` entries and
ships them on the `index` command payload under the `withCount` key:

```json
{
  "withCount": [
    {"attributeName": "projectsCount", "relationshipName": "projects"},
    {"attributeName": "activeMembersCount", "relationshipName": "users", "where": {"active": true}}
  ]
}
```

The frontend-model controller picks up the payload in
`frontendModelWithCount()` and re-applies `.withCount(...)` on the
scope inside `frontendModelIndexQuery()`. Each serialized record then
includes the counts on a dedicated `__associationCounts` key alongside
`__preloadedRelationships`, and `FrontendModelBase#instantiateFromResponse`
hydrates them into the frontend record's `_associationCounts` map.

## Example: paginated index with counts

```js
const perPage = 30
const organizations = await Organization
  .ransack({name_cont: query})
  .withCount({
    projects: true,
    activeMembersCount: {relationship: "users", where: {active: true}}
  })
  .page(page)
  .perPage(perPage)
  .toArray()

const totalCount = await Organization
  .ransack({name_cont: query})
  .count()
```
