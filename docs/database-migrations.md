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

## Datetime Storage

Velocious stores persisted `Date` values as UTC instants. Runtime-local timezone and `timezoneOffsetMinutes` are not applied when records are inserted, updated, or read back from storage.

External datetime strings follow the same rule:

- Strings with a timezone suffix, such as `2026-06-12T14:30:00+02:00`, are parsed as that exact instant and stored in UTC.
- Timezone-less datetime strings, such as `2026-06-12 12:30:00`, are treated as UTC.

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
