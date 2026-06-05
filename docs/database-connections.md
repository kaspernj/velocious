# Database Connections

Use `configuration.withConnections` when code needs a checked-out database connection scope:

```js
await configuration.withConnections({name: "report export"}, async (dbs) => {
  await dbs.default.query("SELECT 1")
})
```

The `name` option labels the active checkout. It is intended for debugging connection usage, especially code paths that hold onto connections longer than expected or fail to release them.

`configuration.ensureConnections` accepts the same option when it needs to open a new scope:

```js
await configuration.ensureConnections({name: "invoice cleanup"}, async (dbs) => {
  await dbs.default.query("SELECT 1")
})
```

When a current connection scope already exists, `ensureConnections` reuses it and keeps the existing checkout name.

For MySQL and MariaDB, Velocious also writes the active checkout name to the session variable `@velocious_connection_checkout_name`. The variable is reset to `NULL` when the connection is checked in, so inspecting server-side connection/session state can identify the code currently using a checked-out connection.
