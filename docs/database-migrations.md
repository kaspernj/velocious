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
