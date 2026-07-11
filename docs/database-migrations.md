# Database Migrations

Velocious migration helpers default new tables to UUID primary keys:

```js
await this.createTable("tasks", (table) => {
  table.string("name")
  table.references("project")
  table.timestamps()
})
```

The implicit `id` column and implicit `table.references(...)` column use the current database's `primaryKeyType`. When omitted, `primaryKeyType` defaults to `"uuid"`.

Set `primaryKeyType` on a database configuration to change the default for that database:

```js
export default new Configuration({
  database: {
    production: {
      default: {
        type: "mysql",
        primaryKeyType: "bigint"
      }
    }
  }
})
```

Explicit migration types still take precedence:

```js
await this.createTable("legacy_events", {id: {type: "bigint"}}, (table) => {
  table.references("task", {type: "bigint"})
  table.references("external_user", {type: "uuid"})
})
```

SQLite stores auto-increment primary keys through its special `INTEGER PRIMARY KEY` form even when a migration asks for `bigint`, while non-primary reference columns keep the configured `bigint` type. PostgreSQL emits `BIGSERIAL` for auto-increment `bigint` primary keys.

Features that need framework-owned tables, such as record auditing, should
still be declared through normal application migrations. See
[record auditing](auditing.md#schema) for the shared `audits` table layout.

`removeIndex(tableName, nameOrColumns, args)` drops an index by explicit name, or by deriving the same database-specific default name that `addIndex(...)` uses when passed columns:

```js
await this.addIndex("tasks", ["project_id", "position"], {unique: true})
await this.removeIndex("tasks", ["project_id", "position"])

await this.addIndex("tasks", ["slug"], {name: "index_tasks_slug_unique", unique: true})
await this.removeIndex("tasks", "index_tasks_slug_unique")
```

Use the columns form for indexes created by `addIndex(...)` without an explicit name so SQLite and the other drivers drop their own generated names correctly.

## Datetime Storage

Velocious stores persisted `Date` values as UTC instants. Runtime-local timezone and `timezoneOffsetMinutes` are not applied when records are inserted, updated, queried, or read back from storage.

External datetime strings are normalized before storage:

- Strings with a timezone suffix, such as `2026-06-12T14:30:00+02:00`, are parsed as that exact instant and stored in UTC.
- Timezone-less datetime strings, such as `2026-06-12 12:30:00`, are interpreted in the active request/configured timezone when one is available, then stored in UTC. Without a request/configured timezone they are treated as UTC.

Frontend-model HTTP requests include the browser timezone automatically when the browser can resolve one, or the timezone configured with `FrontendModelBase.configureTransport({timeZone})`. Frontend-model `create`/`update` values and `where`/`findBy` datetime filters use the same parsing rule, so filtering with the same timezone-less datetime string that created a row matches the stored UTC instant.

SQLite stores new datetime rows with an explicit `Z` suffix. Legacy SQLite rows written by older Velocious versions may contain timezone-less local wall-clock strings. Use `migrateLegacyLocalDateTimesToUtcStorage(...)` in a migration to rewrite those rows:

```js
await this.migrateLegacyLocalDateTimesToUtcStorage({
  tables: ["ticket_scans"],
  columnsByTable: {
    ticket_scans: ["scanned_at", "valid_from", "valid_until"]
  },
  legacyLocalOffsetMinutes: new Date().getTimezoneOffset()
})
```

`legacyLocalOffsetMinutes` uses JavaScript's `Date#getTimezoneOffset()` sign convention: minutes to add to local wall-clock time to get UTC. Omit it to parse legacy values in the runtime's current local timezone, including that timezone's daylight-saving rules for each date.

## Structure Snapshots and the Migration Ledger

`db:schema:dump` generates `db/structure-<identifier>.sql` files from the current database state. Each file contains the full DDL for tables, indexes, views, and triggers, followed by `INSERT INTO schema_migrations (version) VALUES (...)` for every applied migration version. This embeds the migration ledger directly in the checked-in snapshot.

When a fresh database is created from a structure file via `db:schema:load`, those insert rows repopulate the `schema_migrations` table so the loaded database knows exactly which migrations have already been applied. Subsequent `db:migrate` calls see those versions and skip them.

Without the embedded ledger rows, loading a structure dump would produce a database with all the post-migration tables but an empty `schema_migrations` table. The next `db:migrate` would then attempt to re-run every migration, causing duplicate-table errors or migration-version conflicts against the already-present schema.

For this reason checked-in structure files are expected to contain `schema_migrations` row data as part of their normal output. The migration ledger rows serve as the authoritative record of which migrations the snapshot represents, and should be committed to version control alongside the DDL.
