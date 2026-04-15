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
| `foreignKey` | Explicit foreign key column (inferred by default) |
| `primaryKey` | Primary key on the parent model (defaults to `"id"`) |
| `polymorphic` | Enable polymorphic lookup via type+id columns |
| `through` | Name of an intermediate `hasMany` relationship for many-to-many |

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
