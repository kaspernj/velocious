# Schema Metadata Cache

Velocious caches schema metadata on each database driver instance. This avoids repeated schema introspection during startup and model initialization, especially table-list, column-list, foreign-key, index, and structure SQL queries.

The cache is in-process only. It is not written to disk and is discarded when the driver instance is closed.

## Rolling schema compatibility

An initialized model keeps its physical column-to-attribute map for the life of
that metadata generation. During a rolling deployment, a newer process can add
a column while an older process still serves requests. A later `SELECT *` in
the older process can therefore return a raw column that is absent from its
model map.

`record.attributes()` omits those unmapped raw columns instead of treating them
as model attributes. The values remain available through `rawAttributes()` and
explicit `readColumn()` access, and explicit `readAttribute()` calls remain
strict. Calculated values explicitly selected with a terminal `AS` alias are
tracked per query and per hydrated record, so those aliases remain present in
`attributes()` without changing global model metadata. Preload queries carry
only their own calculated aliases to the records they hydrate.

## Invalidation

Velocious clears the cache automatically after successful schema-changing SQL sent through `db.query(...)`. This covers migrations and helpers such as `createTable`, `dropTable`, `renameColumn`, `ALTER TABLE`, `CREATE INDEX`, `DROP INDEX`, and `COMMENT ON`.

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
