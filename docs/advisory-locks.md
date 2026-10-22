# Advisory locks

Velocious exposes cooperative, session-scoped **advisory locks** as static helpers on every record class. They are the preferred way to serialize a specific piece of functionality (a counter decrement, an external API refresh, a background job scheduler) without touching row or table locks, and without blocking any reader or writer that is not participating in the same named lock.

## Why not row locks?

`SELECT ... FOR UPDATE` is a fine tool when the thing you want to protect really is "whatever rows this query touches", but it has two properties that make it unsuitable as a general-purpose serialization mechanism:

1. It blocks **every** subsequent read or write of the same row, not just the function you are trying to serialize. A background job scheduler that takes a row lock on `accounts` to decide whether to enqueue a sync will block an unrelated UI update to the account name.
2. The lock is scoped to whatever SQL happens to touch that row next, not to an identifiable piece of code. Two unrelated features that both lock the same row interact in surprising ways.

Advisory locks take a plain string name. Callers who participate in the same name serialize; everybody else goes unblocked. No rows, columns, or tables are involved.

## API

```js
// Blocking: waits up to the acquisition bound (see "Acquisition bound" below),
// runs the callback, releases in `finally`.
const result = await Account.withAdvisoryLock("sync-account-42", async () => {
  return await syncAccount(42)
})

// Non-blocking: throws `AdvisoryLockBusyError` if anybody already holds the lock.
try {
  await Account.withAdvisoryLockOrFail("sync-account-42", async () => {
    await syncAccount(42)
  })
} catch (error) {
  if (error instanceof AdvisoryLockBusyError) {
    // Another process is already syncing this account; skip this run.
  } else {
    throw error
  }
}

// Optional timeout. Throws `AdvisoryLockTimeoutError` if the lock is not
// granted within `timeoutMs`. Pass `timeoutMs: null` to opt out and block
// forever; omit it to use the acquisition bound described below.
await Account.withAdvisoryLock("daily-report", async () => {
  await generateDailyReport()
}, {timeoutMs: 5_000})

// Optional hold timeout. Throws `AdvisoryLockHoldTimeoutError` if the callback
// runs longer than `holdTimeoutMs`. The advisory lock is held on a dedicated
// lock connection, so Velocious can release it even while the callback's own
// database work is still hung.
await Account.withAdvisoryLockOrFail("queue-planner", async () => {
  await runQueuePlanner()
}, {holdTimeoutMs: 600_000})

// Optional dedicated lock session. Acquires and releases the advisory lock on
// a freshly spawned dedicated connection even when no hold timeout is set. The
// callback still runs on the caller/model connection. This avoids same-session
// lock re-entrancy, which matters when the caller connection is reused across
// concurrent work (for example a test runner pinning one connection) and you
// need independent lock ownership rather than re-entrant acquisition.
await Account.withAdvisoryLock("sync-account-42", async () => {
  await syncAccount(42)
}, {dedicatedConnection: true})

// Defer instead of throwing. The non-throwing counterpart of
// `withAdvisoryLockOrFail` for hot paths: contention is a first-class result,
// not an exception. A contended lock resolves to `{acquired: false, reason:
// "contended"}` — zero exception traffic, and because the probe is a single
// immediate try-acquire, zero pinned connections. Reschedule via your own
// event-driven retry machinery.
const outcome = await Account.withAdvisoryLockOrDefer("sync-account-42", async () => {
  return await syncAccount(42)
})

if (!outcome.acquired) {
  // Another process is syncing this account; defer and reschedule this run.
} else {
  console.log(outcome.result)
}

// Introspection. Useful in diagnostics; callers that want to act on the
// result should prefer `withAdvisoryLockOrFail` to avoid a TOCTOU window.
const isBusy = await Account.hasAdvisoryLock("sync-account-42")
```

Both `withAdvisoryLock` and `withAdvisoryLockOrFail` release the lock in a `finally` block, so the callback's return value is propagated on success and the lock is released on either a thrown error or an early return. Calls without a positive `holdTimeoutMs` acquire and release the advisory lock on the caller's existing database connection/context to avoid extra connection overhead. Calls with a positive `holdTimeoutMs` acquire and release the advisory lock through a dedicated lock connection; the callback keeps using the caller's existing database connection/context. When `holdTimeoutMs` fires, the dedicated lock connection releases the advisory lock before `AdvisoryLockHoldTimeoutError` is thrown.

Pass `{dedicatedConnection: true}` to force a dedicated lock connection even when no `holdTimeoutMs` is set. The callback still runs on the caller/model connection; only lock ownership moves to the spawned session. Use this when the caller connection may be shared or reused and you need independent, non-re-entrant lock semantics.

Each database connection also keeps a counted registry of advisory locks it successfully acquires. Before a checked-out connection returns to its pool, Velocious releases every lock still in that registry so an abandoned critical section cannot leak a session lock into the next checkout. Closing a connection performs the same cleanup before closing the physical database session, including the dedicated connection used by positive `holdTimeoutMs` calls. Cleanup preserves re-entrant acquisition counts and attempts every tracked lock; release failures are surfaced rather than silently leaving a reusable connection poisoned.

## Acquisition bound

A blocking acquisition that passes no `timeoutMs` no longer waits forever. It waits up to a finite bound and then reports `AdvisoryLockTimeoutError`, so a wedged lock holder stops consuming pool connections indefinitely:

1. An explicit per-call `timeoutMs` always wins. Pass `timeoutMs: null` to opt back in to the driver's indefinite wait.
2. Otherwise the database configuration's `advisoryLockAcquireTimeoutMs` applies, and a `null` there opts out.
3. Otherwise the framework default applies: 15 minutes (`DEFAULT_ADVISORY_LOCK_ACQUIRE_TIMEOUT_MS` in `src/database/advisory-lock-bound.js`).

```js
// databaseConfiguration: {
//   advisoryLockAcquireTimeoutMs: 120_000  // 2 minutes, or null for the old indefinite wait
// }
```

Why the bound exists: an unbounded `GET_LOCK` on MySQL/MariaDB waits for one year. When one holder wedged — a killed process, a runner that died while holding the lock, a connection that never returned — every later caller on the same lock name queued behind it, and each waiter parked a pooled connection in the server's `User lock` state. A single wedged name therefore drained the pool and stalled dispatch process-wide while nothing logged. The default sits far above any contention observed in healthy operation, so a legitimate lock handover is never cut off; a wedged holder now surfaces as a named `AdvisoryLockTimeoutError` instead of a silent outage.

## Contended-acquire defer semantics

`withAdvisoryLockOrFail` reports contention by throwing `AdvisoryLockBusyError`. On a hot path — a build fan-out that claims per-child admission locks thousands of times per minute — exception traffic is exactly the wrong shape: constructing and catching an `Error` per contention is expensive, and a caller that forgets the `try`/`catch` turns a busy lock into a crash. `withAdvisoryLockOrDefer` makes "holder busy, defer me" a plain return value:

```js
const outcome = await Account.withAdvisoryLockOrDefer(name, callback, {holdTimeoutMs})
// acquired:  {acquired: true, result: <callback result>}
// contended: {acquired: false, reason: "contended", lockName: name}
```

The result form is **identical across tiers**: the runner drives the driver's `tryAcquireAdvisoryLock`, which maps per-tier to `GET_LOCK(name, 0)` (MySQL/MariaDB), `pg_try_advisory_lock` (PostgreSQL), `sp_getapplock @LockTimeout = 0` (SQL Server), the process-local waiter queue (SQLite) and the Node file lock. A caller never branches on the backend, and the defer path never acquires anything — no lock is held, no connection is pinned, and no `Error` is constructed. This is the primitive hot paths use instead of choosing between a 15-minute blocking `withAdvisoryLock` wait and a thrown timeout (STC-261, parent epic STC-209; the tier chain is designed in [docs/advisory-lock-backends.md](advisory-lock-backends.md)).

## Duration telemetry

A lock convoy is only fixable when it is attributable. Velocious emits **event-driven** telemetry reports on the acquisition and release events themselves — never from a periodic scanner — on the framework-error channel:

```js
configuration.getErrorEvents().on("framework-error", (payload) => {
  if (payload.context === "advisory-lock-telemetry") {
    // payload: {event, lockName, backendTier, durationMs, outcome, timeoutMs,
    //           holderId, holderConnectionId, holderLookupError}
  }
})
```

| Event | Fires when | Attribution carried |
| --- | --- | --- |
| `advisory-lock-slow-acquire` | an acquire wait **completed** slower than `slowAcquireMs` (default 5 s) | `outcome: "acquired"` plus the wait duration |
| `advisory-lock-acquire-timeout` | a wait **exceeded its timeout** | `outcome: "timeout"`, the effective `timeoutMs`, and the holder identity available on the tier at that moment |
| `advisory-lock-slow-hold` | a hold outlived `slowHoldMs` (default 60 s), reported at release | the measured hold duration |

Holder attribution per tier, captured at the event moment (best-effort — a failed lookup is recorded as `holderLookupError` and never changes the acquisition outcome):

- **MySQL/MariaDB**: `IS_USED_LOCK(name)` → the holder's server connection id.
- **PostgreSQL**: `pg_locks` (advisory, hashed key) → the holder's backend pid.
- **SQL Server**: `sys.dm_tran_locks` (`APPLICATIONLOCK`) → the holder's request session id.
- **SQLite (Node)**: the file lock's `owner.json` → `pid@hostname`; falls back to the in-process owner's `holderId`.
- **SQLite (process-local)**: the owning driver instance's `holderId`.

Thresholds are configured per database; `null` opts out of a report:

```js
// databaseConfiguration: {
//   advisoryLockTelemetry: {slowAcquireMs: 2000, slowHoldMs: null}
// }
```

When no `framework-error`/`all-error` listener is registered, each report also writes a one-line summary to `stderr` so a convoy is never completely silent. The reports are the framework-side half of the STC-261 acceptance: a contended lock in production is attributable to a concrete holder without SSH forensics.

## Scope

Advisory locks run as a **two-tier chain** on every driver:

1. **Process-local pre-filter tier** (shared base driver, `src/database/drivers/base.js`): a process-wide FIFO waiter queue per lock name. Callers inside the same process serialize here before any driver-native lock query is issued, so a contended same-process waiter never parks a pooled connection in a driver lock state (MariaDB `User lock`, `sp_getapplock` session hold). This tier is a **pre-filter, never the authority**: a grant means only "you are next in this process." Cross-process/cross-host exclusion is confirmed by tier 2 (or, once the pluggable backend chain lands, the configured cross-host backend). If the native tier denies or times out, the in-process hold is rolled back and the next waiter is served.
2. **Driver-native tier** (`GET_LOCK` / `pg_advisory_lock` / `sp_getapplock` / the Node SQLite filesystem lock): the authority that confirms exclusion against other processes and hosts.

The bounded acquisition timeout covers the whole chain: the process-local wait and the native wait share one deadline budget.

Database advisory locks are **per session/connection**. Velocious uses the caller connection for ordinary advisory-lock calls and owns a separate lock connection for calls with a positive `holdTimeoutMs`:

- Without a positive `holdTimeoutMs`, the caller connection acquires and releases the named advisory lock.
- With a positive `holdTimeoutMs`, a dedicated lock connection acquires and releases the named advisory lock while the callback runs in the caller's existing database context.
- Opening a **new** connection inside the callback (for example by spawning a child `withConnections` block) does not inherit an ordinary caller-connection lock. It also does not affect a hold-timeout lock's ownership; that lock remains owned by the dedicated lock connection until the helper releases it.
- Nested `Record.withAdvisoryLock(...)` calls with the **same** name can behave differently depending on whether the outer call uses `holdTimeoutMs`. Prefer to avoid nested same-name locks; use `withAdvisoryLockOrFail` if contention should skip instead of waiting.

## Driver support

| Driver        | Implementation                                                                             |
| ------------- | ------------------------------------------------------------------------------------------ |
| MySQL/MariaDB | process-local pre-filter tier, then `GET_LOCK(name, timeout)` / `RELEASE_LOCK(name)` / `IS_USED_LOCK(name)` |
| PostgreSQL    | process-local pre-filter tier, then `pg_advisory_lock($key)` / `pg_try_advisory_lock($key)` / `pg_advisory_unlock($key)` with FNV-1a name hashing |
| SQL Server    | process-local pre-filter tier, then `sp_getapplock @LockOwner = 'Session'` / `sp_releaseapplock` |
| SQLite        | process-local pre-filter tier (shared base driver); on Node, a filesystem lock directory as the driver-native tier |

### PostgreSQL name hashing

PostgreSQL advisory locks are keyed by `bigint`, not by string, so the driver hashes the lock name with 64-bit FNV-1a and passes the resulting signed 64-bit integer to `pg_advisory_lock`. This means two distinct names will almost always map to distinct keys, but the mapping is not cryptographic — do not use advisory locks for security decisions.

### SQLite emulation

SQLite has no native advisory lock primitive, so SQLite builds rely on the shared process-local pre-filter tier in the base driver: a per-name owner map plus a FIFO waiter queue. This is the fast path and handles all intra-process contention; it is also the only implementation available to environments without filesystem access (web/sql.js and Expo native). Because plain SQLite has no driver-native tier behind it, its locks are **process-local only** — multi-process SQLite setups must not read them as cross-process mutual exclusion.

On **Node**, the Node SQLite driver layers a filesystem lock directory on top as its driver-native tier, so multiple Node processes writing to the same SQLite database file see consistent mutual exclusion. Each named lock maps to a directory next to the database file (`<databaseDir>/<databaseName>.velocious-advisory-locks/<safeName>-<hash>.lock/`) created with `fs.mkdir` for atomicity. Inside the directory the driver writes an `owner.json` metadata file with the holder's PID, hostname, and acquisition timestamp.

Stale lock recovery: if the metadata names a PID on this host that is no longer running (`kill(pid, 0) → ESRCH`), the directory is treated as stale and removed by the next acquirer. Cross-host ownership is treated as live because the PID cannot be reliably probed on another machine; operators running Node against a network-mounted SQLite file should remove stale lock directories by hand if they linger.

Web (sql.js) and Expo native inherit the shared in-process implementation unchanged, because they have no `fs` access.

## The opt-in file-lock backend tier

The Node SQLite filesystem layer above is one use of a shared backend primitive
(`src/database/advisory-lock-file-backend.js`), which implements the `file` tier of the
[advisory-lock backend chain](advisory-lock-backends.md). The tier is **disabled by default**
and only selectable by explicit configuration — it is never the primary backend and never
auto-enabled when other tiers are down:

```js
new Configuration({
  advisoryLocks: {
    backends: {
      // Off by default. Enabling it is the deployment's explicit single-host declaration.
      file: {enabled: true, directory: "tmp/advisory-locks", leaseMs: 30_000, renewIntervalMs: 10_000}
    },
    policy: [
      // A name is served by the file tier only when its policy explicitly opts in.
      {name: "my-single-host-thing", minTier: "file", preferredTier: "file"},
      // A cross-host-minimum name is refused the file tier, loudly.
      {name: "cross-host-thing", minTier: "driver-native", preferredTier: "file"}
    ]
  }
})
```

- **Minimum-tier rule.** A lock name whose declared `minTier` is `driver-native` or
  `lock-server` can never be served by the file tier. An acquisition that would fall to the
  file tier for such a name throws `AdvisoryLockMinTierRefusedError` before contacting the
  backend and emits `advisory-lock-min-tier-refused` on the framework-error channel.
- **Leases.** Each hold carries a `leaseMs` lease renewed on `renewIntervalMs` while held. A
  killed holder's lock directory is reclaimed by the next acquirer once its lease expires or
  its PID is found dead on this host (`kill(pid, 0)` → `ESRCH`), so a crashed holder never
  leaves a stuck lock.
- **Limits.** The file tier is same-host only (shared filesystem at best), provides **no
  fencing tokens** — a partitioned holder cannot be checked against a monotonic authority —
  and cross-host owners are only reclaimable via lease expiry because PID liveness cannot be
  probed remotely. Every acquisition from this tier reports `fencingSupported: false` rather
  than pretending. It consumes no database connection.
- **Provenance.** Every acquisition reports the tier that served it on the callback's
  `lockBackend` argument (`{backend, driverType, fencingSupported}`) and on
  `configuration.getAdvisoryLockBackendStatus(lockName)`, so a fallback to the file tier is
  visible in logs and diagnostics.

## Central lock server (tier (b))

Set `advisoryLocks.backends.lockServer` and prefer the tier per lock name to stop a
held lock from pinning a pooled connection:

```js
new Configuration({
  advisoryLocks: {
    backends: {
      lockServer: {
        enabled: true,           // defaults to true when host/port/url (or the env pair) is set
        host: "127.0.0.1",       // VELOCIOUS_LOCK_SERVER_HOST
        port: 3006,              // VELOCIOUS_LOCK_SERVER_PORT
        authToken: "...",        // must match CONSENS_LOCK_AUTH_TOKEN on the daemon
      },
    },
    policy: [
      {name: "my-app-build-start-*", minTier: "driver-native", preferredTier: "lock-server"},
    ],
  },
})
```

- **Selection is policy-driven, never automatic.** Only a lock name whose resolved policy
  declares `preferredTier: "lock-server"` uses the tier; undeclared names keep today's
  driver-native behavior.
- **Leases + fencing.** The server grants a lease renewed every third of `leaseMs`
  (30s by default; the daemon advertises its own value in `hello-ack`). A lease the
  server fences is reported as `AdvisoryLockLostError` once the critical section settles,
  carrying `epoch` and `currentEpoch`, so a caller can tell that its exclusivity was
  compromised. The callback also receives the granted `epoch` on `lockBackend`.
- **Unavailability fails upward, loudly.** When the daemon cannot be reached (bounded
  connect timeout, then a `reprobeCooldownMs` cache) an acquisition for a name whose
  `minTier` permits `driver-native` continues on the driver tier and emits
  `advisory-lock-fallback {lockName, preferredTier, servedBy, reason}` on the
  framework-error channel. `minTier: "lock-server"` throws
  `AdvisoryLockBackendUnavailableError` instead — never a silent downgrade.
- **No database connection while waiting or holding.** The tier keeps one socket per
  process; `dedicatedConnection` and `holdTimeoutMs` still work but no longer spawn a
  dedicated database session on this tier.
- **Diagnostics.** `configuration.getAdvisoryLockBackendStatus(lockName)` reports
  `lockServer: {connected, lastError, lastProbeAt, leasedNames}` alongside the
  acquisition provenance and resolved policy.

## Errors

- `AdvisoryLockTimeoutError` — thrown by `withAdvisoryLock` when a `timeoutMs` elapses before the lock is granted. Exposes `error.lockName`.
- `AdvisoryLockBusyError` — thrown by `withAdvisoryLockOrFail` when the lock is already held. Exposes `error.lockName`. `withAdvisoryLockOrDefer` reports the same contention as `{acquired: false, reason: "contended"}` instead of throwing.
- `AdvisoryLockHoldTimeoutError` — thrown by either helper when a `holdTimeoutMs` elapses while the callback is still running. Exposes `error.lockName`.

All three are exported from `velocious/build/src/database/record/index.js` (and the matching source path under `src/`).

Two backend-chain errors join them (see [advisory-lock-backends.md](advisory-lock-backends.md) §9):

- `AdvisoryLockMinTierRefusedError` — thrown when an acquisition would have to be served by a
  tier below the lock name's declared minimum tier. Exposes `error.lockName`,
  `error.requestedBackend`, `error.minTier`.
- `AdvisoryLockBackendUnavailableError` — thrown when no enabled backend satisfies the name's
  minimum tier. Exposes `error.lockName`, `error.minTier`, `error.reasons`.
