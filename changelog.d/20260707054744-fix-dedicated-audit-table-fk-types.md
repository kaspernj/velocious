Fix dedicated audit table FK column types so `klass`-resolved relationship queries work correctly. Previously `table.references()` defaulted the FK column type to the table's own primary-key type, which could be `uuid` on the driver while the referenced model's PK is `integer`. The query normalizer would then reject numeric values for UUID-typed columns. Explicitly pass `type: "integer"` in `createDedicatedAuditTable` FK references.

Also document `klass` as a relationship option.
