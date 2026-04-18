# Query bulk operations

Velocious model queries support bulk operations that execute a single SQL statement against all rows matching the query's WHERE clause.

## updateAll

`Query#updateAll(data)` executes a single `UPDATE ... SET ... WHERE ...` statement. It bypasses model lifecycle callbacks (`beforeUpdate`, `afterUpdate`, validations) — use it for efficient batch updates where per-row hooks aren't needed.

### Usage

```js
// Update all tasks in a project to done
await Task.where({projectId: project.id()}).updateAll({isDone: true})

// Update with multiple conditions
await User.where({accountId: account.id()}).where("last_seen_at < ?", cutoff).updateAll({isActive: false})

// Set a column to NULL
await Task.where({id: taskId}).updateAll({description: null})
```

### Parameters

- `data` — `Record<string, any>`: camelCase attribute names mapped to values. Keys are converted to snake_case column names via `inflection.underscore()`. Values are quoted through the driver. `null` renders as SQL `NULL`.

### Behavior

- Executes one SQL statement regardless of how many rows match.
- Uses the query's existing WHERE clause (built via `.where()`, `.whereNot()`, etc.).
- No-ops when `data` is empty (no query is sent).
- Does **not** fire model lifecycle callbacks — `beforeUpdate`, `afterUpdate`, `beforeSave`, `afterSave`, and validations are all skipped.
- Does **not** update `updated_at` automatically — include it in `data` if needed:
  ```js
  await Task.where({projectId}).updateAll({isDone: true, updatedAt: new Date()})
  ```

### When to use

- Timestamp updates from lifecycle hooks (e.g. `lastSeenAt` on presence connect/disconnect).
- Batch status transitions where per-row callbacks aren't required.
- Counter resets, flag flips, or soft-delete sweeps across many rows.

### When NOT to use

- When model validations, `afterUpdate` hooks, or websocket broadcast publishers need to fire — use `toArray()` + per-record `save()` instead.
- When you need the updated records returned — `updateAll` returns `void`.

## destroyAll

`Query#destroyAll()` loads all matching records via `toArray()` and calls `destroy()` on each one individually. Unlike `updateAll`, it **does** fire model lifecycle callbacks (`beforeDestroy`, `afterDestroy`) on every record.

```js
await Task.where({projectId: project.id()}).destroyAll()
```
