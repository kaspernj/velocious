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

`AsyncTrackedMultiConnection` pools default to a maximum of `10` live database connections per configured pool. Configure `database.<environment>.<identifier>.pool.max` when a process needs a different cap. Set `pool.max` to `null` only for deliberately unbounded pools; leaving the value out keeps the default cap and protects long-running processes from exhausting the database server.

When every allowed connection is checked out, additional checkouts wait for a compatible connection to be checked in or for capacity to be freed. Waiting checkouts time out after `10000` ms by default. Configure `database.<environment>.<identifier>.pool.checkoutTimeoutMillis` to change that wait, or set it to `null` to wait indefinitely.

Velocious adds checkout names and active database annotations to SQL comments while a query is executing. This makes active queries easier to identify in process/activity views such as `SHOW FULL PROCESSLIST`, PostgreSQL `pg_stat_activity.query`, and SQL Server request SQL text:

```sql
/* velocious checkout="report export" annotations="invoice batch" */ SELECT 1
```

Wrap a narrower section of work with `withDatabaseAnnotation` when the checkout name describes the broad owner but you need additional context for the queries inside it:

```js
import { withDatabaseAnnotation } from "velocious/build/src/database/annotations.js"

await configuration.withConnections({name: "report export"}, async (dbs) => {
  await withDatabaseAnnotation("invoice batch", async () => {
    await dbs.default.query("SELECT 1")
  })
})
```

Nested annotations are joined in order, for example `annotations="report export > invoice batch"`.

For MySQL and MariaDB, Velocious also writes the active checkout name to the session variable `@velocious_connection_checkout_name`. The variable is reset to `NULL` when the connection is checked in, so inspecting server-side connection/session state can identify the code currently using a checked-out connection. MySQL/MariaDB do not expose a reliable dynamically-changeable idle process-list name through the current driver, so process-list checkout names are visible on active queries through the SQL comment.

For PostgreSQL, Velocious sets `application_name` to the active checkout name and resets it when the connection is checked in. This exposes the checkout owner in `pg_stat_activity.application_name`, including idle checked-out sessions.

When the built-in [Debug Endpoint](debug-endpoint.md) is enabled, its database pool snapshots include live checkout names, active query annotations, transaction depth, schema-cache sizes, in-use checkout timing (`checkedOutAt`/`checkedOutForMs`), checked-in idle timing (`checkedInAt`/`idleForMs`), and pending checkout timing (`pendingCheckouts[].enqueuedAt`/`waitingForMs`/`remainingTimeoutMs`) for Velocious-owned connections.
