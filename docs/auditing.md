# Record Auditing

Velocious can write Rails-style audit rows for model lifecycle changes.
Declare auditing on the model class after relationships and validations are
registered:

```js
import TaskBase from "../model-bases/task.js"

class Task extends TaskBase {}

Task.belongsTo("project")
Task.validates("name", {presence: true})
Task.audited()

export default Task
```

## Schema

Applications must create the shared audit tables in their own migrations. Match
the `auditable` reference type to the primary-key type used by the audited
models:

```js
import Migration from "velocious/build/src/database/migration/index.js"

export default class CreateAuditTables extends Migration {
  async up() {
    await this.createTable("audit_actions", {id: {type: "bigint"}}, (table) => {
      table.string("action", {index: {unique: true}, null: false})
      table.timestamps()
    })

    await this.createTable("audit_auditable_types", {id: {type: "bigint"}}, (table) => {
      table.string("name", {index: {unique: true}, null: false})
      table.timestamps()
    })

    await this.createTable("audits", {id: {type: "bigint"}}, (table) => {
      table.references("audit_action", {foreignKey: true, null: false, type: "bigint"})
      table.references("audit_auditable_type", {foreignKey: true, null: false, type: "bigint"})
      table.references("auditable", {null: false, polymorphic: true, type: "bigint"})
      table.json("audited_changes")
      table.json("params")
      table.timestamps()
    })
  }
}
```

The shared lookup tables keep repeated action names and audited model types out
of the `audits` rows while still storing `auditable_type` directly for simple
polymorphic queries.

## Automatic Audits

`Model.audited()` registers lifecycle callbacks that create audit rows for:

- `create`: stores the new values assigned before insert.
- `update`: stores the new values for changed attributes.
- `destroy`: stores the record attributes as they were before deletion.

Audit change keys use model attribute names such as `projectId`, not database
column names such as `project_id`.

## Manual Audits

Call `record.createAudit(...)` when application code needs to record a custom
action:

```js
await task.createAudit({
  action: "publish",
  params: {
    source: "admin"
  }
})
```

`params` is optional JSON metadata. Velocious does not attach a current user or
request automatically in this first built-in auditing slice; pass that context
explicitly in `params` when an app needs it.

## Querying Missing Audits

Use `Model.withoutAudit(action)` to find records that have not yet received an
audit row for an action:

```js
const unreviewedTasks = await Task.withoutAudit("reviewed")
  .where({projectId: project.id()})
  .order({column: "name", direction: "ASC"})
  .toArray()
```

## Audit Events

Register callbacks with `Model.onAudit(action, callback)`:

```js
const unsubscribe = Task.onAudit("create", async ({auditId, record}) => {
  await notifyAuditCreated({auditId, taskId: record.id()})
})
```

The callback runs after the audit row is inserted. If the callback throws during
a lifecycle audit, the surrounding save/destroy operation fails with that error,
so use it for required follow-up work rather than best-effort logging.
