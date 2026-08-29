# Operation-scoped transactions

`configuration.withTransaction` provides an explicit, opt-in transaction for model work on one database:

```js
const result = await configuration.withTransaction({
  databaseIdentifier: "default",
  name: "accept ticket"
}, async (operation) => {
  const Tickets = operation.forModel(Ticket)
  const ticket = await Tickets.findByOrFail({code})

  ticket.setAccepted(true)
  await ticket.save()

  await operation.beforeCommit(async ({operation: guardedOperation}) => {
    const currentTicket = await guardedOperation
      .forModel(Ticket)
      .findByOrFail({id: ticket.id()})

    if (!currentTicket.acceptanceStillOwnedBy(workerId)) {
      throw new Error("Ticket acceptance ownership changed")
    }
  })

  await operation.afterCommit(async () => {
    await cacheAcceptedTicket(ticket.id())
  })

  return {ticketId: ticket.id()}
})
```

The callback either commits all operation-owned database work or rolls it back. The optional `name` appears as the connection checkout name. `databaseIdentifier` is required because an operation never spans databases.

## Model and record ownership

Start model work through `operation.forModel(ModelClass)`. The returned scope supports the normal query builder plus `build` and `create`:

```js
await configuration.withTransaction({databaseIdentifier: "default"}, async (operation) => {
  const Projects = operation.forModel(Project)
  const project = await Projects
    .preload("tasks")
    .find(projectId)

  project.tasks().build({name: "Ship"})
  await project.save()
})
```

Records built, created, or loaded by the scope retain the operation for subsequent saves, destroys, relationship loads/builds, preloads, autosaves, validations, list/counter lifecycle work, record-change notifications, query-data/with-count follow-up queries, and framework sync publication/tracking. A relationship targeting another database is rejected instead of silently escaping the transaction.

Custom lifecycle code can inspect `record.databaseOperation()`. When it returns an operation, use that operation's model scope for additional writes instead of starting from another static model:

```js
Task.afterSave(async (task) => {
  const operation = task.databaseOperation()
  const TaskEvents = operation ? operation.forModel(TaskEvent) : TaskEvent

  await TaskEvents.create({taskId: task.id(), type: "saved"})
})
```

See [Record lifecycle callbacks](lifecycle-callbacks.md) for callback declaration
forms, ordering, and why `afterSave` is still pre-commit.

Do not switch back to static model calls for work that belongs to the operation:

```js
// Operation-owned
await operation.forModel(Task).create({name: "Import"})

// Unrelated work; not part of the operation
await Task.create({name: "Import"})
```

The operation, its query scopes, its connection, and its records are valid for database work only until `withTransaction` resolves or rejects. This includes an operation-owned `beforeCommit` guard and `afterCommit` callback, which run before `withTransaction` settles. Retain scalar results such as IDs, not the operation handle. In-memory attributes can still be read from a returned record, but reloading or persisting that operation-bound record after completion raises. Query the model normally after success when a longer-lived record is needed.

## Pre-commit guards, nested work, and commit callbacks

`operation.beforeCommit(callback)` registers an operation-owned guard on the current transaction or savepoint frame. The callback receives an object containing the same active `operation`, so it can re-read operation-owned model state without switching connections:

```js
await configuration.withTransaction({databaseIdentifier: "default"}, async (operation) => {
  const ScannerDevices = operation.forModel(ScannerDevice)
  const scannerDevice = await ScannerDevices.findByOrFail({id: scannerDeviceId})

  scannerDevice.setStatus("reported")
  await scannerDevice.save()

  await operation.beforeCommit(async ({operation: guardedOperation}) => {
    const currentScannerDevice = await guardedOperation
      .forModel(ScannerDevice)
      .findByOrFail({id: scannerDeviceId})

    if (!currentScannerDevice.statusReportOwnedBy(reportToken)) {
      throw scannerStatusInvalidatedError
    }
  })
})
```

Velocious runs the guard after that frame's transaction callback resolves successfully and immediately before the outer `COMMIT` or nested savepoint release. If the guard throws or rejects, the existing rollback path rolls back the frame, discards its `afterCommit` callbacks, and propagates the guard error. A transaction callback that rejects never runs its guards. Each registered guard runs once for each successful callback attempt; if an outer deadlock retry reruns the transaction callback, that callback registers a fresh guard for the new attempt.

Always await `beforeCommit` registration inside the transaction callback. Registration requires an active transaction frame and an active operation handle, and therefore cannot move the check past durability. The guard keeps the operation's pinned connection, tenant configuration, and exclusive shared-pool lease. Start model work through the callback's `operation`; unrelated Single-pool work continues waiting until the operation commits or rolls back.

`operation.transaction(callback)` creates a savepoint on the same connection. A rejected nested callback rolls back to its savepoint; a successful nested callback remains part of the outer transaction and is still rolled back if the outer callback rejects.

Each nested frame owns its guards. A successful nested callback runs its guards before releasing its savepoint. A rejected nested guard rolls back only that savepoint under the same semantics as a rejected nested transaction callback.

`operation.afterCommit(callback)` attaches the callback to the current operation transaction/savepoint frame:

- a rolled-back frame discards its callbacks;
- a committed nested frame passes its callbacks to the parent frame;
- outer callbacks run once after the database commit;
- a callback failure rejects `withTransaction`, but the database is already committed and cannot be rolled back;
- a deadlock-shaped callback failure is surfaced without retrying the already durable operation.

Use `beforeCommit` for final operation-owned validity or ownership checks that must still be able to roll back database writes. The framework cannot roll back arbitrary memory or external effects. Update caches, publish external messages, or make irreversible state visible only in `operation.afterCommit`, or after `withTransaction` resolves successfully. An after-commit callback that needs database models must keep using `operation.forModel(...)` or an operation-bound record.

## Raw SQL

`operation.connection()` deliberately exposes the pinned, operation-owned driver facade:

```js
await configuration.withTransaction({databaseIdentifier: "default"}, async (operation) => {
  await operation
    .connection()
    .query("UPDATE imports SET state = 'complete' WHERE id = 42")
})
```

Its queries, mutations, nested transactions, last-insert-ID reads, and after-commit registrations retain operation ownership. Prefer model scopes when possible so records and relationships also inherit ownership.

## Pool behavior and concurrency

With `AsyncTrackedMultiConnection`, the operation receives a fresh physical checkout even when the caller already has an async-context connection. That checkout stays pinned to the operation; unrelated concurrent work checks out another connection.

With `SingleMultiUsePool` (SQLite and SQL.js), the operation uses the pool's existing physical connection under an exclusive FIFO lease. Velocious does not create a second SQL.js connection or database snapshot. Operation-owned calls are reentrant. Unrelated normal queries, writes, transactions, and after-commit registrations wait until the operation commits or rolls back, then run outside it. An operation requested while an unrelated ordinary transaction is already open is rejected, so it can never attach itself as that transaction's savepoint; start it after the ordinary transaction finishes.

Real SQL.js persistence defers its debounced database export while a transaction is open. Pending bytes flush before an outer transaction when needed and after its commit or rollback, so exporting persistence state cannot close the in-memory SQL transaction.

The operation also captures the checked-out connection's resolved configuration key. If tenant context changes to another physical database under the same identifier, model, record, and raw operation work is rejected. Start a separate operation inside each tenant context instead of carrying an operation across `runWithTenant`.

Because unrelated Single-pool work cannot finish until the operation releases its lease, do not await it from inside the operation:

```js
let unrelatedWrite

await configuration.withTransaction({databaseIdentifier: "default"}, async (operation) => {
  await operation.forModel(Task).create({name: "Owned"})
  unrelatedWrite = Task.create({name: "Independent"})
})

await unrelatedWrite
```

Usually the clearer choice is to keep the write operation-owned or start unrelated work only after `withTransaction` returns. The lease is released in cleanup paths for callback, rollback, query, checkout, and post-commit failures.

## Migrating a consumer transaction

For consumers such as ticket-app #10495:

1. Wrap the singular-database unit of work in `configuration.withTransaction({databaseIdentifier}, callback)`.
2. Replace static model entry points inside the callback with scopes created by `operation.forModel`.
3. Keep using records and relationships loaded from those scopes; they propagate ownership.
4. Register final ownership or validity checks with `operation.beforeCommit(async ({operation}) => ...)` when they must run after the main callback but still be able to abort the commit.
5. Move cache publication and other irreversible effects into `operation.afterCommit`, or perform them after the outer promise resolves.
6. Return IDs or plain result data. Do not retain and reuse the operation, its connection, its scopes, or operation-bound records for later database work.
7. Split cross-database changes into explicit separate operations with application-level compensation; one operation intentionally rejects them.

See [Database Connections](database-connections.md) for ordinary non-transactional connection scopes and pool diagnostics.
