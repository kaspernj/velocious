# Test transaction sessions

`TestTransactionSession` lets a backend test owner keep one rollback boundary across long-lived external services, in-process requests, background workers, and tenant-resolved physical databases. It extends the test runner's shared-transaction broker, including its per-connection FIFO and child savepoint behavior.

```js
import TestTransactionSession from "velocious/build/src/testing/test-transaction-session.js"

const session = await TestTransactionSession.begin({configuration})

try {
  await session.enrollDatabase({
    databaseIdentifier: "projectTenant",
    tenant: {slug: "alpha"}
  })

  // Send only over a live, authenticated control/IPC channel.
  backend.send({type: "test-transaction-join", session: session.joinMessage()})
} finally {
  session.revoke()
  await session.drain()
  await session.rollback()
}
```

An already-running backend joins each request or job with `TestTransactionSession.join(message, callback)`. This AsyncLocal context is also the mechanism warm pooled job children receive at dispatch time; it does not depend on the environment captured when the process started.

The random capability is session-scoped, revoked before rollback, and intentionally omitted from debug snapshots. Never put the message or capability in job arguments or rows, logs, environment files, generated sources, fixtures, snapshots, or durable records. Transport it only in a live control message.

Enrollment is lazy and exact: logical database identifier plus the pool's physical configuration reuse key. Different tenants enroll as different connections. Joined tenant-only pools create broker proxies, but SQL is accepted only after the owner enrolls that exact identity; an unknown tenant fails closed instead of opening an untracked real connection. Enrollment also installs a provider selected by the live async join context for in-process request/Scoundrel dispatch, so overlapping sessions on one configuration retain independent physical connections and cleanup ownership.

The test runner's legacy automatic transaction mode remains narrower: tenant-only identifiers omitted from its published broker coordinates continue to use independent real connections. That compatibility fallback applies only to valid automatic child configuration. An explicit `TestTransactionSession` join uses dynamic identity enforcement and never falls back for an unknown or unenrolled tenant.

`cleanup()` is the idempotent shorthand for revoke, drain/transport close, rollback, and release. Shutdown rejects new work first, drains admitted FIFO work, closes child sessions, then rolls back every enrollment. Repeated cleanup or rollback does not release connections twice, and cleanup failures are aggregated rather than swallowed.

## Explicit opt-outs

Do not use a shared transaction session for behavior that requires DDL, lock contention between physical connections, independently committed data, or genuine database concurrency. Mark those tests explicitly with `databaseCleaning: {transaction: false, truncate: true}` and use ordinary pools. DDL setup required by a transactional test must be committed before `begin`.
