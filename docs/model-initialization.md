# Model Initialization

Velocious record classes can be initialized eagerly through the application
configuration, or lazily the first time an async class API needs table metadata.

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
Actual connection or metadata initialization failures still propagate.

`configuration.runWithTenant(...)` only changes the async tenant context. Use the
`Tenant` facade when callback code needs checked-out connections and ready tenant
model metadata.

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
