Add `Migration#indexExists(tableName, indexName)` for guarding index creation in rerunnable migrations, mirroring `columnExists`. Missing tables resolve to `false` instead of throwing.
