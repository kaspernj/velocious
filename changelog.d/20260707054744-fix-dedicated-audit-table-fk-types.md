Fix dedicated audit table relationship loading while preserving Velocious' UUID-default migration behavior. `createSharedAuditTables()` and `createDedicatedAuditTable(...)` now keep their audit table IDs and audit reference columns on the driver's default UUID primary-key type unless the application explicitly overrides a non-default primary-key type.

Also document `klass` as a relationship option.
