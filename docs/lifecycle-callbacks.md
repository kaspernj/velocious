# Record lifecycle callbacks

Velocious records support lifecycle callbacks around validation, persistence, and
destruction. Keep callbacks small and cohesive: the declaration style does not by
itself prevent one callback from accumulating unrelated responsibilities.

This guide covers database record callbacks. Frontend-model resource hooks such
as `BaseResource.beforeCreate(model, ...)` are a [separate API](frontend-model-resources.md).

## Supported phases

Records support these phases:

- `beforeValidation`
- `beforeSave`
- `beforeCreate`
- `beforeUpdate`
- `beforeDestroy`
- `afterSave`
- `afterCreate`
- `afterUpdate`
- `afterDestroy`

## Declaration styles

### Implicit instance method

A model can define a method with the lifecycle phase name. Velocious invokes it
with the record as `this`:

```js
class Task extends TaskBase {
  beforeSave() {
    this.setName(this.name().trim())
  }
}
```

Use this form when the model owns one small, cohesive operation for the phase.

### Explicit function registration

An explicitly registered function receives the record as its argument:

```js
Task.beforeSave(async (task) => {
  await task.doSomething()
})
```

JavaScript functions may declare fewer parameters than they receive. A
zero-argument callback is valid when it does not need the record:

```js
Task.beforeSave(async () => {
  await doSomething()
})
```

Do not add a placeholder record parameter when the callback does not use it.

Velocious does not rebind registered functions. In particular, arrow functions
capture lexical `this`, so this does not access the record:

```js
// Wrong: `this` is lexical here; it is not the Task record.
Task.beforeSave(async () => {
  const task = this
  await task.doSomething()
})
```

Use the callback argument when a function registration needs the record. Use an
implicit instance method or a string registration when instance `this` is desired.

Function registrations are useful for small declarative behavior, framework
features, plugins, and dynamic installers that retain the callback reference for
later unregistration.

### Explicit named-method registration

String registration invokes the named instance method with the record as `this`:

```js
class Task extends TaskBase {
  normalizeName() {
    this.setName(this.name().trim())
  }

  calculateTotals() {
    // ...
  }
}

Task.beforeSave("normalizeName")
Task.beforeSave("calculateTotals")
```

String registration is intentional public API and is included in
`LifecycleCallbackType`. A missing or non-function method fails loudly.

## Choosing a form

- Keep an implicit hook when it is one small, cohesive, model-owned operation.
- Use multiple explicit named-method registrations for independent concerns,
  visible ordering, or behavior that may be installed or removed separately.
- Prefer descriptive named methods over a large anonymous callback once logic is
  nontrivial; named methods are easier to navigate, test, and reuse.
- Use a function registration for small declarative or dynamically installed
  behavior, especially when the exact function reference is needed for teardown.
- Keep orchestration in the registration list and business logic in descriptive
  model methods or services.
- Split by responsibility, not merely by line count.

Avoid using one lifecycle method as a container for unrelated persistence,
notifications, cache changes, and remote calls:

```js
// Avoid this shape.
async beforeSave() {
  await this.normalizeEverything()
  await this.recalculateUnrelatedCounters()
  await sendRemoteNotification()
  await updateCache()
}
```

Make independent responsibilities and their order visible instead:

```js
Task.beforeSave("normalizeAttributes")
Task.beforeSave("calculateTotals")
Task.afterSave("registerCommittedSideEffects")
```

`registerCommittedSideEffects` must register irreversible work with
`afterCommit`; `afterSave` itself is still pre-commit. An explicit registration
can also become a giant callback—the design benefit comes from separation and
visible ordering, not from static-registration syntax alone.

## Ordering

For each phase, Velocious:

1. Runs registered callbacks sequentially, awaiting each in registration order.
2. Passes the record argument to function registrations.
3. Invokes string registrations as instance methods with the record as `this`.
4. Invokes the implicit same-named instance method after all registrations.

If the lifecycle method itself is explicitly registered by name, for example
`Task.beforeSave("beforeSave")`, it runs exactly once at that registration
position and is not repeated as the implicit tail. Registering any callback more
than once is not a deduplication mechanism; each registration remains effective.

A create follows this order:

1. `beforeValidation`
2. validations
3. `beforeSave`
4. `beforeCreate`
5. row persistence
6. `afterCreate`
7. relationship and attachment autosaves
8. `afterSave`

An update substitutes `beforeUpdate` and `afterUpdate` for the create-specific
phases. Destruction runs `beforeDestroy`, dependent handling and deletion, then
`afterDestroy`.

## Transactions and side effects

`beforeValidation` runs before `save()` opens its transaction frame (and may
still be inside a caller's outer transaction). `beforeSave`, the create/update
callbacks, persistence, relationship and attachment autosaves, and `afterSave`
run inside the save transaction. `afterSave` means after the persistence phase,
not after commit. A callback that throws or rejects stops the operation; failures
inside the transaction follow its rollback path.

Do not publish messages, send notifications, mutate remote systems, update
external caches, or otherwise expose irreversible state directly from
`afterSave` when database durability matters. Register that work with
`afterCommit`, or perform it after the outer transaction resolves:

```js
class Task extends TaskBase {
  async registerCommittedSideEffects() {
    const taskId = this.id()

    await this.connection().afterCommit(async () => {
      await publishTaskSaved(taskId)
    })
  }
}

Task.afterSave("registerCommittedSideEffects")
```

Capture stable scalar identifiers or data for committed work rather than relying
on mutable dirty state. Callback code should also tolerate transaction or caller
retries; irreversible pre-commit effects cannot be rolled back.

For operation-scoped records, inspect `record.databaseOperation()` and use
`operation.forModel(...)` for related database work instead of escaping to an
unrelated static model call. Use the operation's `afterCommit` when appropriate.
See [Operation-scoped transactions](operation-scoped-transactions.md) for handle
lifetimes, nested transactions, guards, commit callbacks, and retry behavior.

## Model state

- Use generated typed accessors and setters instead of writing raw attributes.
- `changes()` is keyed by database column name. Check the snake_case key when the
  database column is snake_case.
- Persistence reloads/clears dirty state. Capture previous values or the needed
  change data before persistence when an `afterSave` callback needs them.
- Use `isNewRecord()` and `isPersisted()` intentionally when behavior differs
  between create and update.
- Relationship autosaves may invoke callbacks on related records. Avoid callback
  cycles and recursive `save()` calls.
- Keep callback work in the same database, tenant, and operation context as the
  owning record.

## Bulk operations

`updateAll()` uses one SQL update and bypasses validations and record lifecycle
callbacks. `destroyAll()` loads and destroys records individually, so
`beforeDestroy` and `afterDestroy` run for every record. Do not choose a bulk API
when correctness depends on per-record hooks. See [Query bulk operations](query-bulk-operations.md)
for the complete behavior.

## Registration lifecycle and tests

Registrations live on the model callback map and persist until unregistered.
Register callbacks deterministically during model initialization, not in request
handlers, constructors, or other repeatedly executed runtime paths.

Dynamic installers must retain the exact function or string reference and call
`unregisterLifecycleCallback` during teardown:

```js
const publishAfterSave = async (task) => {
  await publishTask(task)
}

Task.afterSave(publishAfterSave)

// During teardown:
Task.unregisterLifecycleCallback("afterSave", publishAfterSave)
```

Tests that alter class-level callbacks must unregister or restore them in a
`finally` block so state cannot leak into later examples. Prefer the public
registration APIs over replacing `_lifecycleCallbacks`, which is internal state.
Framework specs may replace it narrowly for isolation; application code should
not. Test registration order and observable outcomes rather than
implementation-only private state. Test external effects at the commit boundary,
including the rollback case.

## AI implementation checklist

Before adding or changing record lifecycle code:

1. Search the model for implicit and registered callbacks for the same phase.
2. Identify current registration order, including framework-installed callbacks.
3. Keep each callback cohesive and name it by responsibility.
4. Preserve database, tenant, and operation ownership.
5. Put irreversible effects behind `afterCommit`.
6. Check bulk APIs and relationship autosaves for bypasses or recursion.
7. Add focused tests for ordering, rollback, and committed side effects.
8. Never silently swallow callback errors.
9. Do not modify generated model bases manually.
10. Update this guide when public lifecycle behavior changes.
