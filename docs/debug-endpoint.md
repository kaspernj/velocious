# Debug Endpoint

Velocious can expose a built-in diagnostics endpoint for inspecting a running server. It is disabled by default and must be enabled explicitly in configuration:

```js
const configuration = new Configuration({
  debugEndpoint: true
})
```

The default endpoint is `GET /velocious/debug`. It returns pretty-printed JSON intended for humans during debugging.

Use a custom path when the default conflicts with an application route:

```js
const configuration = new Configuration({
  debugEndpoint: {path: "/internal/debug"}
})
```

The payload includes:

* server runtime details such as environment, PID, uptime, Node version, platform, and memory usage
* configuration flags relevant to debugging, including `debug`, `debugEndpoint`, `autoload`, and tenant database scope enforcement
* database pool state for every active database identifier, including pool class, resolved non-secret database configuration, idle/in-use/pending connection counts, spawned connection count, and pending checkout snapshots with `checkoutName`, `enqueuedAt`, `waitingForMs`, `timeoutMillis`, `timeoutAt`, and `remainingTimeoutMs`
* live database connection snapshots, including driver class, checkout name, open transaction count, schema cache size, current pool state, reuse key, checkout/check-in timestamps (`checkedOutAt`/`checkedInAt`), elapsed checkout/idle durations (`checkedOutForMs`/`idleForMs`), and active query details when a query is running
* WebSocket registration and subscription counts
* background job configuration presence

Database connection snapshots include the same checkout names configured through `configuration.withConnections({name}, ...)` and `configuration.ensureConnections({name}, ...)`. Use `checkedOutForMs` to find long-held in-use connections, `idleForMs` to confirm checked-in connections are waiting for reuse or reaping, and `pendingCheckouts[].waitingForMs` plus `pendingCheckouts[].remainingTimeoutMs` to spot callers waiting for pool capacity before their checkout fails. While a query is running, the active query snapshot also includes the active database annotations from `withDatabaseAnnotation(...)`. See [Database Connections](database-connections.md) for checkout names and query annotations.

Do not enable this endpoint on publicly reachable production servers unless it is protected by application-level network or authentication controls. The response intentionally omits database passwords and cookie secrets, but it still exposes operational details that are useful to attackers.
