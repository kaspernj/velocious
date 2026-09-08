# Query filtering

Backend ORM queries accept attribute hashes through `Model.where(...)` and chained
`.where(...)` calls. Model attributes (such as `projectId`) and physical column
names (`project_id`) resolve through model metadata. Separate predicates are
combined with AND.

## Explicit, null-aware IN

Use an explicit `{in: [...]}` condition at a model column to include SQL NULL in
a membership query:

```js
const tasks = await Task
  .where({projectId: project.id(), description: {in: [null, "manual"]}})
  .toArray()
```

This selects exactly the project's tasks whose description is NULL or `"manual"`.
The mixed predicate is locally parenthesized:

```sql
project_id = ... AND (description IN ('manual') OR description IS NULL)
```

Sibling key order, member order and chained filters do not weaken the project
constraint. Repeated nulls are harmless.

| Members | Predicate |
| --- | --- |
| `["manual", "github"]` | `column IN ('manual', 'github')` |
| `[null, "manual"]` | `(column IN ('manual') OR column IS NULL)` |
| `[null]` or `[null, null]` | `column IS NULL` |
| `[]` | `1=0` (matches nothing) |

Members must be strings, finite numbers, booleans or `null`. Empty strings, `0`
and `false` are real members. Undefined values, sparse array holes, non-finite
numbers, dates, nested arrays and object members are rejected before database
execution. A column descriptor must have its own `in` array and no extra own
keys, including symbol or non-enumerable keys. Non-array operands and malformed
model-column descriptors throw during query construction/rendering; they are
never silently dropped.

Model-aware predicates retain the existing column conversions and driver value
quoting: SQLite boolean encoding, numeric-to-text conversion (including
PostgreSQL `character varying`), and numeric UUID no-match filtering. Filtering
out invalid numeric UUID members does not discard a genuine null; if nothing
remains, the predicate matches nothing. MSSQL `text` columns are cast to
`NVARCHAR(MAX)` for the explicit IN comparison. Inputs are not mutated, so frozen
or reused hashes and arrays are supported.

## Relationships, tables and aliases

Relationship hashes remain relationship traversal, including automatic joins,
mapped columns and distinct aliases when the same table is joined twice:

```js
const tasks = await Task
  .where({project: {creatingUserReference: {in: [null, "manual"]}}})
  .toArray()
```

Already table-qualified leaves also support the operator:

```js
const tasks = await Task
  .where({tasks: {name: {in: [null, "Manual"]}}})
  .toArray()
```

Table-qualified hashes use the generic SQL serializer: use physical column names
and database-ready scalar values. They do not gain model type normalization or
the model-aware MSSQL text cast; prefer model attributes or relationship leaves
when those conversions are needed.

An actual attribute or related column named `in` is not itself an operator:
`Model.where({in: ["manual"]})` remains ordinary direct-array membership when `in`
is a model column. Relationships and table hashes are not reinterpreted globally.

The low-level, untyped `Query` API preserves its ambiguous top-level table form:
`query.where({someTable: {in: [null, "manual"]}})` still addresses a column named
`in` on `someTable`, using legacy direct-array semantics. To opt in, use an
unambiguous qualified leaf such as
`query.where({someTable: {someColumn: {in: [null, "manual"]}}})`. Raw nested table
recursion remains supported; operator validation applies where an `in` descriptor
is recognized, not to every arbitrary nested raw hash.

## Negation and compatibility

Both `.whereNot({description: {in: [null, "manual"]}})` and
`.where.not({description: {in: [null, "manual"]}})` negate the complete grouped
predicate. A negated null-only list means IS NOT NULL; a negated empty list is
true (other query filters still apply). A negated non-null list follows SQL
three-valued logic: NULL rows are not automatically included.

Direct arrays, such as `where({description: [null, "manual"]})`, retain their
existing rendering and driver-specific NULL behavior. They do **not** opt in to
an IS NULL branch. Use the explicit descriptor when NULL rows must match; legacy
empty arrays still match nothing.

This feature adds no frontend-model transport protocol, Ransack grammar,
subquery support or additional operators. See [query bulk operations](query-bulk-operations.md)
for operations that reuse a query's filtering conditions.
