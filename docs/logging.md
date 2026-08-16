# Logging

Request logs use the same remote address as `request.remoteAddress()`. If your
app runs behind a reverse proxy, configure trusted proxies so logs and
controllers resolve the real client IP consistently; see
[trusted proxies](trusted-proxies.md).

Velocious logs database queries by default at `info` level using Rails-style query names and elapsed time. Query logging defaults to off in the `test` environment so CI output stays focused on failures:

```text
Task Load (1.9ms)  SELECT `tasks`.* FROM `tasks` WHERE `tasks`.`id` = 1 LIMIT 1
  ↳ src/routes/tasks/controller.js:12:in show
```

Model-backed reads use names such as `Task Load`, `Task Count`, and `Task Pluck`. Model writes use names such as `Task Create`, `Task Update`, and `Task Destroy`. Raw `db.query(...)` calls use `SQL`.

The source arrow is included only when Velocious can identify application code. Dependency and framework frames, including `node_modules`, are filtered out; if no application frame is available, Velocious logs only the timed SQL line.

Query logs use the same configured logger outputs as other Velocious logs and are skipped when no output emits `info`. Disable them with `logging: {queryLogging: false}` or by removing `info` from your configured levels. Enable them in tests with `logging: {queryLogging: true}` and choose the output you want, such as `console: true` for local debugging or `file: true` for a test log file.

## Deadlock retry diagnostics

When a MySQL/MariaDB deadlock or lock-wait timeout causes another outer transaction attempt,
Velocious emits `database-deadlock-retry` on `configuration.getErrorEvents()`. The same payload is
mirrored to `all-error` with `errorType: "database-deadlock-retry"`. This remains a retry-only event:
`willRetry` is always `true`, and an exhausted/non-retried attempt emits neither event before its
original error is rethrown.

```js
configuration.getErrorEvents().on("database-deadlock-retry", ({context}) => {
  console.warn("Database deadlock retry", context)
})
```

Every context contains `stage`, `driverType`, `contentionKind` (`deadlock` or
`lock-wait-timeout`), `attempt`, `maxAttempts`, `willRetry`, and
`transactionAttemptDurationMs`. The duration covers the complete failed outer attempt, including
rollback, and is captured before asynchronous diagnostics begin. Pool-owned connections also include
`databaseIdentifier: "[REDACTED]"`, `databaseIdentifierFingerprint`, and
`databaseIdentityFingerprint`. The first fingerprint is an opaque, bounded `sha256:` value derived
with a domain-separated hash of the complete logical pool identifier; the second is independently
derived from the exact physical configuration reuse identity. Raw logical identifiers, reuse keys,
hosts, database names, usernames, locators, tenant descriptors, connection strings, and credentials
are never reported. Directly constructed, unpooled drivers omit all three database identity fields.

When a checkout has a name, the context includes `operationName` and
`operationNameFingerprint`. Because checkout names have no separate trusted-provenance signal, raw
names are never included: `operationName` is always `[REDACTED]`. The bounded `sha256:` fingerprint
uses at most the first 1,024 characters plus the complete input length and remains available for
correlation without retaining the name. Database annotations are not copied into this event.

When contention came from the standard query path, the optional `sqlOperation` and
`sqlFingerprint` fields contain the SQL verb and an `fnv1a64:` shape fingerprint. The fingerprint is
computed after comments and literal spellings are normalized. SQL text and bound or interpolated
values are never included.

Only `contentionKind: "deadlock"` attempts `SHOW ENGINE INNODB STATUS` on a bounded, separate
connection. `statusCapture` is `captured` or `failed`. Lock-wait timeouts use
`statusCapture: "not-applicable"` and never attach the server's historical latest-deadlock report.
A captured optional `innodbDeadlockSummary` preserves `transactions` and
`victimTransaction`, and adds bounded `transactionNodes`. Each node has an `ordinal`, `locks` owned
or awaited by that transaction, and MariaDB `conflictingLocks` counterparty edges. A counterparty
edge uses `state: "conflicting"`; its owner is unavailable before another transaction header and is
intentionally not invented. Both collections share the limit of eight records per transaction and
32 records globally. Records contain only `state` (`held`, `waiting`, or `conflicting`), `lockMode`,
and opaque `sha256:` `tableFingerprint`/`indexFingerprint` values. Parsing searches at most the first 65,536 status
characters for the deadlock header, scans at most 16,384 characters of that section and 1,024
characters per line, emits at most eight transaction nodes, and reports its
`sectionTruncated`, `transactionNodesTruncated`, and `lockRecordsTruncated` flags. Raw SQL,
identifiers, transaction IDs, values, record hex/ASCII, and physical-row details are discarded and
are not fingerprinted.

Collection is asynchronous and best-effort. The retry decision, retry budget, jitter/backoff,
rollback, callback replay, return value, and final thrown error do not wait for or depend on capture,
parsing, or event listeners. Expected status timeout/permission failures set `statusCapture: "failed"`.
Unexpected parser or diagnostics-pipeline failures emit `framework-error` and its matching
`all-error`; each event emission is independently guarded so a listener failure cannot alter the
transaction result.
