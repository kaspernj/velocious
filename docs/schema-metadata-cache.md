# Schema Metadata Cache

Velocious caches schema metadata on each database driver instance. This avoids repeated schema introspection during startup and model initialization, especially table-list, column-list, foreign-key, index, and structure SQL queries.

The cache is in-process only. It is not written to disk and is discarded when the driver instance is closed.

## Batched column prefetch

Model initialization would otherwise read each table's columns on its own, which
turns a boot into one catalog query per model — and an application that runs N
HTTP worker processes pays it N times over.

Drivers that can describe several tables in one statement implement
`batchTableColumns(tables)`, returning columns keyed by table name:

- MySQL and MariaDB read `information_schema.COLUMNS` aliased to the
  `SHOW FULL COLUMNS` shape (`NULLIF(COLUMN_DEFAULT, 'NULL')` compensates for
  MariaDB reporting a SQL NULL default as the literal string `'NULL'`).
- PostgreSQL reads `information_schema.columns` once for the requested tables.
- MSSQL drops the per-table filter from its three-way `INFORMATION_SCHEMA` join.
- SQLite cannot describe several tables in one statement, so it returns `null`.

`driver.prefetchTableColumns(tables)` uses the batch when the driver supports it
and falls back to bounded-concurrency per-table reads otherwise. Either way the
result is seeded into the per-table cache via `seedTableSchemaMetadata`, so the
model initialization that follows resolves without querying.

`SchemaMetadataPrefetcher` groups the application's model classes by database,
includes each translated model's `<table>_translations` table, and runs the
prefetch once per database before `InitializerFromRequireContext` initializes the
models. On a 71-model schema spread over three databases this took a worker boot
from ~74 catalog queries (33 `SHOW FULL COLUMNS` plus 38 MSSQL joins) to five:
one table list and one column query per database.

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
