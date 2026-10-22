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

Applications must create audit tables in their own migrations. The built-in
helpers use Velocious' default UUID primary keys and UUID reference columns.
Only pass explicit types when an audited model deliberately uses a non-default
primary-key type:

```js
import Migration from "velocious/build/src/database/migration/index.js"

export default class CreateAuditTables extends Migration {
  async up() {
    await this.createSharedAuditTables()
  }
}
```

The shared lookup tables keep repeated action names and audited model types out
of the `audits` rows while still storing `auditable_type` directly for simple
polymorphic queries.

Use a dedicated audit table when one model should keep its audit rows separate:

```js
import Migration from "velocious/build/src/database/migration/index.js"

export default class CreateProjectAudits extends Migration {
  async up() {
    await this.createDedicatedAuditTable("projects")
  }
}
```

For a UUID-backed `projects` table, this creates `project_audits` with UUID
`id`, `project_id`, and `audit_action_id` columns. If `projects.id` is a
non-default integer/bigint key, pass the matching reference type explicitly
instead of relying on the UUID default.

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

## Excluding high-frequency attributes

`audited()` accepts an optional `except` list naming attributes that must never be
written to the audit trail:

```js
Build.audited({
  except: [
    "executorHeartbeatAt",
    "executorProgressAt",
    "executorProgressEvent",
    "executorProgressSequence",
    "executorOutputByteCount"
  ]
})
```

Use this for telemetry columns. Every audited update inserts into `audit_actions`
inside the same transaction that holds the business row's X lock, so a column
written every few seconds per running record makes the audit table a deadlock
partner for the row it audits: two such transactions can cycle on `<table>` and
`audit_actions.index_on_action`, and InnoDB rolls one of them back - taking
whatever unrelated work shared that transaction with it.

Excluded attributes are matched by attribute name or column name. Business
attributes are still audited; create and destroy audits are unaffected.
