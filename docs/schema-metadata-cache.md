# Schema Metadata Cache

Velocious caches schema metadata on each database driver instance. This avoids repeated schema introspection during startup and model initialization, especially table-list, column-list, foreign-key, index, and structure SQL queries.

The cache is in-process only. It is not written to disk and is discarded when the driver instance is closed.

## Invalidation

Velocious clears the cache automatically after successful schema-changing SQL sent through `db.query(...)`. This covers migrations and helpers such as `createTable`, `dropTable`, `renameColumn`, `ALTER TABLE`, `CREATE INDEX`, and `DROP INDEX`.

If another process changes the schema outside the running Velocious process, clear the cache before reading schema metadata again:

```js
await configuration.ensureConnections(async (dbs) => {
  dbs.default.clearSchemaCache()
})
```

## Disabling

Schema metadata caching is enabled by default. Disable it for a database by setting `schemaCache: false` on that database config:

```js
export default new Configuration({
  database: {
    development: {
      default: {
        type: "mysql",
        schemaCache: false
      }
    }
  }
})
```
