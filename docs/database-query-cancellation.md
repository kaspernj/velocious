# Database Query Cancellation

MySQL and MariaDB queries can be cancelled with an `AbortSignal`. Pass the signal to a raw driver query:

```js
const controller = new AbortController()

await configuration.ensureConnections({databaseIdentifiers: ["default"]}, async (connections) => {
  await connections.default.query("SELECT expensive_report()", {signal: controller.signal})
})
```

Database model queries expose the same contract through `signal(...)`. Query clones created by operations such as `first`, `findBy`, `count`, and `pluck` preserve the signal:

```js
const tasks = await Task
  .where({state: "open"})
  .signal(controller.signal)
  .toArray()
```

Cross-tenant aggregates accept the signal as an option and pass it to every aggregate query:

```js
const rows = await Tenant.aggregateAcross({
  aggregates: {buildCount: {column: "*", op: "COUNT"}},
  identifier: "projectTenant",
  keyColumns: ["docker_server_id"],
  signal: controller.signal,
  subquery: ({table}) => `SELECT docker_server_id FROM ${table("builds")}`
})
```

## MySQL And MariaDB Behavior

Cancellation is currently implemented by the MySQL/MariaDB driver. Other database drivers accept the shared query option but do not yet interrupt in-flight statements.

The driver honors an already-aborted signal without checking out a connection. If cancellation happens while waiting for a pool checkout, the query rejects immediately and any connection returned later is released without running the statement.

For an in-flight statement, the driver destroys the client connection instead of returning a mid-statement connection to the pool. It independently attempts `KILL QUERY` from a throwaway connection so the server releases the statement and its locks immediately. If the kill attempt cannot be issued, the server may continue a non-cooperative statement until it finishes.

Cancellation rejects with `QueryAbortedError`, available from `velocious/build/src/database/query-aborted-error.js`. The error has code `VELOCIOUS_QUERY_ABORTED` and is terminal: Velocious never retries the cancelled query. Destroying a connection also clears cached session state, so settings such as the MySQL session time zone are established again on the replacement connection.
