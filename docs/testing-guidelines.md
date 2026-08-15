# Testing Guidelines

## Preferred strategy
- Prefer end-to-end/browser integration tests over stub-only tests for frontend-model behavior.
- Validate actual browser-to-backend HTTP behavior using Velocious browser test runner.
- Use the [Factory framework](factories.md) to build/create test data instead of repeating direct `Model.create(...)` setup; cover its persistence/association behavior with real dummy-app models in `*.browser-spec.js` files.

## Browser test runner hardening
- Ensure backend app startup/shutdown is guarded with `try/finally`.
- If test framework startup fails, backend server must still stop to avoid leaked open handles.

The `*.browser-spec.js` suffix includes a file in the browser runner without
removing it from the Node database matrix. When a suite is meaningful only in a
real browser, add `tags: ["browser-only"]` to its metadata. The Node runner still
discovers the definition but filters its tests before lifecycle hooks or callbacks
run; the browser runner executes them normally.

## Truncation cleanup

When test isolation uses truncation, `truncateAllTables()` discovers the live table
list through the connection's schema metadata cache and excludes
`schema_migrations`. If there are no other tables, it returns without toggling
foreign keys or flushing persistence. Failed cleanup clears the schema cache and
retries against live metadata for up to six passes, then restores foreign keys before
surfacing the first failure from the final pass.

Cleanup is submitted as one request on PostgreSQL, SQL Server, and the SQLite
family. PostgreSQL uses `TRUNCATE TABLE ... CASCADE` without `RESTART IDENTITY`.
SQLite uses a native multi-statement script of `DELETE` statements, including the
Expo/native and SQL.js paths; SQL.js marks the batch dirty and flushes its persisted
bytes before cleanup resolves. SQL Server attempts `TRUNCATE` per table inside one
guarded T-SQL batch and falls back to `DELETE` only for error 4712, the recognized
foreign-key/reference restriction.

MySQL and MariaDB use a single request only when the database connection already has
`multipleStatements: true`. The option remains off by default; without it, cleanup
uses the existing sequential `TRUNCATE TABLE` path. Enable it explicitly for test
databases where the reduced cleanup round trips are worth accepting stacked SQL:

```js
database: {
  test: {
    default: {
      driver: MysqlDriver,
      type: "mysql",
      multipleStatements: true
    }
  }
}
```

## In-process test database connections
Request tests share only transaction-active, non-tenant database connections with
in-process request handlers. Handlers can therefore see uncommitted test setup while
transaction rollback still isolates and cleans up the test.

Connection eligibility is evaluated when each request is dispatched. A `beforeEach`
hook can start a transaction and issue an HTTP request in the same callback; the
handler immediately reuses that active transaction.

Request tests without an active transaction use independent pooled connections. This
lets concurrency and locking tests opt out of transaction cleanup and exercise
production-style connection behavior. Shared connection state is scoped to the test
lifecycle and cleared around tests.

Transactional background-job tests use the same isolation for real child runtimes.
While a test transaction is active, forked, pooled, and spawned runners route their
physical database operations through a capability-scoped loopback broker owned by
that test attempt. This makes parent uncommitted setup visible to the job, makes job
writes visible to the parent, and lets the normal parent rollback remove both the
job's application writes and its background-job persistence rows. Only active
non-tenant database connections are shared, and multiple databases are matched by
their configured identifiers.

Reusable pooled runners receive broker mode and capability with every job dispatch,
so a warm child can safely cross test-attempt boundaries. A capability change closes
the child's retained proxy state before the next job; concurrent jobs for that same
new capability share the one serialized rotation, while genuinely different active
capabilities are rejected. Missing coordinates fail closed when that dispatch expects
transactional sharing. Concurrent child transactions are
leased FIFO for their complete root-savepoint lifetime, rather than interleaving
savepoints one WebSocket call at a time.

If abandoned savepoint cleanup fails, the broker still releases FIFO waiters and
drains every child socket and server. The teardown caller then receives the collected
driver cleanup errors after transport shutdown completes.

The in-process background-jobs main also enters the attempt's shared connection
context before store work. Dynamic shared-connection providers are installed before
`beforeEach` hooks for every test type, so the provider becomes eligible at the exact
point a hook starts its transaction; a long-lived main cannot acquire an independent
session in a gap between transaction startup and broker activation. This keeps
enqueue, handoff, and terminal job rows on the same parent-owned transaction on
async-tracked database pools instead of checking out an independently committed
connection. Parent store callbacks and child broker calls also share the broker's
per-physical-connection queue, preventing overlapping driver requests while
preserving root-savepoint leases.

The broker is not enabled for tests that opt out of transaction cleanup. Keep
`{transaction: false, truncate: true}` on true concurrency and locking coverage so
child/request work continues to use independent physical connections. Tenant-only
connections are also intentionally excluded from the initial broker mode.

## Coverage focus for frontend models
- Command URL mapping behavior
- `findBy` and `findByOrFail` real HTTP flows
- Date normalization behavior
- Nested object matching
- Explicit null matching
- Validation rejection for unsupported condition values

## Slowest tests report
`velocious test` records each test's wall-clock duration (the whole per-test lifecycle,
including retries) and prints a `Slowest N tests:` section after the run summary, so
suite hotspots and the before/after impact of optimizations are visible from a normal
run. Each line shows the duration, full description and `file:line`.

- Defaults to the **10** slowest tests.
- Set `VELOCIOUS_SLOW_TEST_COUNT=<n>` to change how many are printed; `0` disables the
  report.
- The report is skipped for single-test runs (where it would just be noise).

`TestRunner#getSlowestTests(limit = 10)` exposes the same data programmatically
(slowest first; `limit` of `0` returns every recorded test).

## Duration-aware parallel sharding
Pass `--timing-manifest=<path>` together with `--groups` and `--group-number` to
weight discovered test files by recorded wall-clock duration. The JSON object maps
normalized project-relative test paths to positive finite numbers:

```json
{
  "spec/system/sign-in-spec.js": 42.7,
  "spec/controller/accounts-spec.js": 8.1
}
```

Forward slashes are the portable manifest format; leading `./` and backslashes are
normalized when reading keys. A valid duration takes precedence over the static
directory/browser heuristic for that file. Missing paths, unknown paths, non-number,
non-positive, or non-finite durations fall back per file. Missing, unreadable, or
malformed JSON manifests also leave the existing deterministic heuristic intact.

## Avoiding fixed sleeps
Never `await wait(<fixed ms>)` to let something async settle — it is both slow and
flaky (too short and it races, too long and it wastes wall-clock). Wait for the real
signal or condition instead:

- **Event-driven (a discrete signal):** `waitForEvent(emitter, eventName, {timeoutMs,
  filter})` from `velocious/build/src/testing/test.js` resolves the instant the event
  fires (optionally only when `filter` matches the emitted arguments) and rejects on
  timeout. It always removes its listener. Use it for a background job finishing, a
  model lifecycle event, a websocket message, etc.
- **Condition polling (no discrete event):** awaitery's `waitFor(callback, {timeout,
  wait})` retries `callback` until it stops throwing (default 5s timeout, 50ms
  interval). Use it when there is no event to hook, e.g. `await waitFor(() =>
  expect(rows.length).toEqual(3))`.
- **System/browser tests:** wait for the expected element to appear rather than
  sleeping before interacting with it.

## Browser runner startup ownership

`scripts/prewarm-chromedriver.js` validates Chrome and ChromeDriver by executing
their version commands and persists the selected compatible pair for
`npm run test:browser`. The browser runner launches that exact ChromeDriver as a
managed process group and connects Selenium to its explicit service URL. If
WebDriver session creation fails or times out, the runner terminates ChromeDriver
and its Chrome descendants before stopping SystemTest and the backend.

Startup errors include the startup phase, runtime versions and paths, service URL,
Chrome process snapshots before and after cleanup, and retained ChromeDriver logs
under `tmp/browser-test-chrome/`. Use those diagnostics to fix the concrete service
or Chrome failure; do not stabilize startup by increasing timeouts or retrying the
whole browser test command.
