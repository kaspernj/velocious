# Model Initialization

Velocious record classes can be initialized eagerly through the application
configuration, or lazily the first time an async class API needs table metadata.

Eager `configuration.initializeModels()` is one atomic bootstrap phase.
Concurrent callers share the same in-progress phase, and the initialized flag is
committed only after the application hook, package models, audited relationships,
and frontend-model websocket publishers all finish. If any step raises, every
waiting caller receives that error and a later initialization call reruns the
complete phase; it cannot skip models because an earlier attempt started but did
not finish. This matters for warm background-job children, which remain reusable
after reporting a bootstrap failure and must not admit later jobs with partial
record metadata.

`configuration.closeDatabaseConnections()` invalidates the completed
configuration and model bootstrap. A later `configuration.initialize()` call
reruns model discovery and application initializers before `isInitialized()`
becomes true again. Calls that arrive while connections are closing wait for the
close to finish, and stale initialization work from the previous connection
generation cannot mark the new generation initialized. If that stale work is
still running after the close, the next generation waits for its model,
discovery, and application-initializer phases to settle before retrying the
complete bootstrap. This keeps side-effecting phases serialized while ensuring
the new generation cannot resolve with uninitialized models.

## Lazy record APIs

Async class methods such as `create`, `count`, `find`, `findBy`, `first`,
`last`, `pluck`, `toArray`, `load`, `insertMultiple`, transactions, and
advisory-lock helpers call `ensureInitialized()` before reading table metadata.
This lets applications skip model initialization at boot for models whose tables
may not exist in every deployed database.

Lazy initialization still fails loudly when the model is actually used and the
configured table is missing. Failed initialization attempts clear the in-flight
promise so a later call can retry.

```js
class OptionalLegacyTable extends Record {}

OptionalLegacyTable.setTableName("optional_legacy_table")

// Initializes OptionalLegacyTable before querying optional_legacy_table.
const rows = await OptionalLegacyTable.toArray()
```

## Tenant runtime initialization

`Tenant.with(...)` and `Tenant.each(...)` establish the active tenant's database
connections and initialize registered tenant-switched model classes before their
runtime callbacks run. Concurrent tenant entries share each model class's
in-progress initialization promise, so synchronous query builders such as
`Model.where(...)` cannot observe partially initialized metadata.

Tenant entry checks for the model's base table and any declared translation table
before initializing it. A model whose optional table is absent remains deferred,
so entering a tenant does not fail because of an unused optional integration.
Generated translation classes inherit their translated model's tenant database
resolver, so both metadata sets load from the same tenant connection. Actual
connection or metadata initialization failures still propagate.

`configuration.runWithTenant(...)` only changes the async tenant context. Use the
`Tenant` facade when callback code needs checked-out connections and ready tenant
model metadata.

## Frontend tenant metadata

Immutable frontend tenant handles initialize metadata through
`handle.initialize({databaseIdentifier, migrations, schemaGeneration})`. Record
metadata is keyed by the captured physical database identity and schema
generation, rather than only by model class. Two tenant databases can therefore
initialize the same model concurrently even when their columns differ, without
one tenant overwriting the other's column/table metadata.

Operations created by the initialized handle automatically use that generation's
model-class view. Loaded records and records built through has-many, has-one, or
belongs-to associations retain the same operation ownership; the association
target is bound before its constructor validates metadata. Closing,
deleting, evicting, or shutting down a resident tenant database invalidates only
that physical identity's snapshots; another tenant remains ready. A new schema
generation builds a new snapshot after its migrations run. Failed initialization
does not commit readiness and may be retried.

Eager registered models must have their base and declared translation tables for
frontend readiness to succeed. Set `Model.setEagerLoadRecordMetadata(false)` for
an optional integration whose tables may be absent; it remains lazily initialized
when actually queried.

## Frontend Model Requests

Frontend-model command handling initializes only the requested resource model
class. Other resources configured on the same backend project are not touched
for that request, so an optional legacy resource does not block unrelated
frontend-model commands at boot or request time.

When a request uses `preload`, Velocious initializes only the relationship
target classes needed by that preload tree before building their queries.

Use eager initialization when startup should validate every configured model and
fail immediately on missing tables. Use lazy initialization when a model is an
optional integration point and the missing-table error should surface only if
that model path is used.
