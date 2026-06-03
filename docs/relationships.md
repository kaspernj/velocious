# Relationships

## Relationship types

Velocious supports three relationship types on database records:

```js
Task.belongsTo("project")
Project.hasMany("tasks")
Project.hasOne("projectDetail")
```

## Accepting nested attribute writes

Models can opt into Rails-style nested-attribute writes so a parent's frontend-model `save()` cascades into its `hasMany` children in a single transaction. Each parent model must explicitly declare which relationships accept nested writes:

```js
Project.hasMany("tasks")
Project.acceptsNestedAttributesFor("tasks", {allowDestroy: true, limit: 100})
```

Resource-level configuration via `permittedParams(arg)` is also required before the framework will apply nested writes. The permit is a Rails-style flat array that declares attribute names as strings and nested relationships inline with `{<relationshipName>Attributes: [...]}` objects. See [nested-attributes.md](nested-attributes.md) for the full feature doc, wire payload, and backend cascade semantics.

Each accepts an optional scope callback and/or options object:

```js
Project.hasMany("acceptedTasks", (scope) => scope.where({state: "accepted"}), {className: "Task"})
Project.hasOne("activeDetail", function() { return this.where({isActive: true}) }, {className: "ProjectDetail"})
Comment.belongsTo("acceptedTask", (scope) => scope.where({state: "accepted"}), {className: "Task"})
```

### Common options

| Option | Description |
|---|---|
| `className` | Target model class name (inferred from relationship name by default) |
| `counterCache` | Auto-sync parent count column on child create/update/destroy (belongsTo only) |
| `dependent` | Action on parent destroy: `"destroy"` or `"restrict"` (hasMany/hasOne only) |
| `foreignKey` | Explicit foreign key column (inferred by default) |
| `primaryKey` | Primary key on the parent model (defaults to `"id"`) |
| `polymorphic` | Enable polymorphic lookup via type+id columns |
| `through` | Name of an intermediate `hasMany` relationship for many-to-many |

## Dependent option

The `dependent` option controls what happens to associated records when the parent is destroyed:

```js
User.hasMany("authenticationTokens", {dependent: "destroy"})
Project.hasMany("tasks", {dependent: "restrict"})
```

| Value | Behavior |
|---|---|
| `"destroy"` | Loads and destroys all dependent records before destroying the parent |
| `"restrict"` | Blocks destroy with an error when any dependent records exist (uses a COUNT query, does not load records) |

The restrict error message follows the pattern `"Cannot delete record because dependent <relationship> exist"`.

## Counter cache

The `counterCache` option on `belongsTo` automatically syncs a count column on the parent model when child records are created, destroyed, or reparented:

```js
Comment.belongsTo("task", {counterCache: true})
```

The parent column name follows the convention `<childModelPluralCamelCase>Count` (e.g. `commentsCount` on Task). The parent model must have a setter for this column (e.g. `setCommentsCount`).

Counter cache handles three cases:
- **Create**: increments the parent count
- **Destroy**: decrements the parent count
- **FK change**: decrements the old parent and increments the new parent

## Through relationships (many-to-many)

Use `through` to define a relationship that traverses a join table:

```js
// The intermediate relationship must be defined first
Invoice.hasMany("invoiceGroupLinks")

// Then the through relationship references it by name
Invoice.hasMany("invoiceGroups", {through: "invoiceGroupLinks", className: "InvoiceGroup"})
```

### How it works

Given Invoice → InvoiceGroupLink → InvoiceGroup:

1. The intermediate model (`InvoiceGroupLink`) has a foreign key pointing to the parent (`invoiceId`) and a foreign key pointing to the target (`invoiceGroupId`).
2. The `through` option tells Velocious to resolve the target models by joining through the intermediate table.
3. Both instance-level loading and batch preloading are supported.

### Instance-level loading

```js
const invoice = await Invoice.find(1)
const groups = await invoice.invoiceGroups().toArray()
```

### Batch preloading

```js
const invoices = await Invoice.preload({invoiceGroups: true}).toArray()

for (const invoice of invoices) {
  const groups = invoice.invoiceGroupsLoaded()
}
```

### Collection size

Use `size()` on `hasMany` relationship helpers when you need a count and the relationship may already be loaded:

```js
const count = await invoice.invoiceGroups().size()
```

`size()` returns the loaded collection length when records were preloaded or built in memory. If the relationship has not been loaded and the parent is persisted, it runs a count query. This keeps display virtuals and frontend-model payloads from issuing extra child queries when a resource has already preloaded the relationship.

### Frontend model preloading

Through relationships are also supported in frontend model preload queries:

```js
// Frontend model query with through-relationship preload
const invoices = await Invoice.where({}).preload(["invoiceGroups"]).toArray()
```

The backend resource must include the through relationship in its `static relationships` array:

```js
class InvoiceResource extends FrontendModelBaseResource {
  static relationships = ["invoiceGroupLinks", "invoiceGroups", "invoiceLines"]
}
```

### Requirements

- The intermediate relationship (e.g. `invoiceGroupLinks`) must be a separate `hasMany` on the same model.
- The intermediate model must have `belongsTo` relationships to both the parent and the target.
- The `foreignKey` on the through relationship specifies the column on the **target** table that points to the intermediate table.

### Preloader implementation

The batch preloader for through relationships uses a two-query strategy:

1. Query the intermediate table to build a parent → through-model-ID mapping.
2. Query the target table by foreign key (the column pointing to the intermediate model) to load all target records.
3. Map target records back to their parent models via the intermediate mapping.

This avoids JOIN-based column projection issues and works consistently across all supported database drivers (MySQL/MariaDB, PostgreSQL, SQLite, MSSQL).

## Preloading onto already-loaded records

`Query#preload` loads relationships while a query runs. The same machinery can be pointed at records you already have in memory, so the loaded data lands on the relationship cache and later accessors reuse it instead of issuing their own identical queries.

Call `preload` on a single record with a query built from the model class (or a raw preload spec):

```js
const serviceToken = await ServiceToken.find(id)

await serviceToken.preload(ServiceToken.preload({account: "projects"}))

const projects = serviceToken.account()?.projects()

// Raw spec forms are accepted too.
await serviceToken.preload("account")
await serviceToken.preload({account: "projects"})
```

Preload across many records at once with the `Preloader.preload` static:

```js
import Preloader from "velocious/build/src/database/query/preloader.js"

await Preloader.preload(serviceTokens, ServiceToken.preload({account: "projects"}))
```

### Limiting loaded columns

Pass an object keyed by **target model name** to `select(...)` to narrow the columns loaded for a preloaded relationship. The primary/foreign keys needed to map results back to their parents are always included:

```js
await serviceToken.preload(
  ServiceToken.preload({account: "projects"}).select({Account: ["id"], Project: ["id", "name"]})
)
```

Reading a non-selected attribute on a partially-loaded target raises the usual "attribute hasn't been loaded" error.

Use `selectsExtra(...)` (same object-by-model-name shape) to keep the default `SELECT *` columns and load extra computed selects in addition:

```js
await serviceToken.preload(
  ServiceToken.preload({account: true}).selectsExtra({Account: ["(SELECT count(*) FROM projects WHERE projects.account_id = accounts.id) AS projects_count"]})
)
```

### Idempotency and forcing a reload

A relationship that is already preloaded with all the required columns present is left untouched — no query runs. Requesting a wider column set than was previously loaded re-queries to fetch the missing columns. Pass `{force: true}` to reload regardless, for example when the underlying rows are known to have changed:

```js
await serviceToken.preload(ServiceToken.preload({account: true}), {force: true})
```
