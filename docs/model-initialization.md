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

## Frontend Model Requests

Frontend-model command handling initializes only the requested resource model
class. Other resources configured on the same backend project are not touched
for that request, so an optional legacy resource does not block unrelated
frontend-model commands at boot or request time.

Use eager initialization when startup should validate every configured model and
fail immediately on missing tables. Use lazy initialization when a model is an
optional integration point and the missing-table error should surface only if
that model path is used.
