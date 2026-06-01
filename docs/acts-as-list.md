# Acts As List

Declare a model attribute as a gap-less positional list scoped by another
column. Velocious maintains compact (1,2,3,…) positions automatically on
insert, update, and destroy, similar to the Rails `acts_as_list` gem.

## Declaration

```js
import MyItem from "./models/my-item.js"

MyItem.belongsTo("project")
MyItem.actsAsList("position", {scope: "projectId"})
```

`position` is the camelCase name of the position column. `scope` is the
camelCase name of the column that partitions the list.

## Schema

The migration helper sets up the required NOT NULL position column and the
UNIQUE index on `(scope, position)`:

```js
import Migration from "velocious/build/src/database/migration/index.js"

export default class CreateMyItems extends Migration {
  async change() {
    await this.createTable("my_items", (table) => {
      table.references("project", {null: false})
      table.integer("position", {null: true})
      table.string("name")
      table.timestamps()
    })

    await this.addActsAsList("my_items", "position", {scope: "project_id"})
  }
}
```

Note that `addActsAsList` takes underscored column names (matching the
database), while `Model.actsAsList` takes camelCase attribute names.

## Behaviour

| Operation | Behaviour |
|-----------|-----------|
| Create without position | Auto-appends to the end of the list (`MAX(position) + 1`). |
| Create with position | Bumps existing rows at that position (and above) up by 1, then inserts at the target. |
| Update position | Moves the record: shifts up when moving to a lower position, shifts down when moving to a higher position. |
| Update scope | Moves the record between scopes: closes the gap in the old scope, opens room in the new scope. Without an explicit position, the record is appended to the new scope. |
| Destroy | Closes the gap by shifting all higher positions down by 1. |

## Concurrency

Position shifts run as raw SQL UPDATE statements inside the same database
transaction as the parent `save()` or `destroy()`. The UNIQUE index on
`(scope, position)` protects integrity.

## Re-entrancy guards

Shifts set a flag on the record instance so that `beforeCreate` /
`beforeUpdate` / `beforeDestroy` callbacks are not invoked recursively for
rows touched by position-shift queries.
