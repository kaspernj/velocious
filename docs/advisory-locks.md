# Advisory locks

Velocious exposes cooperative, session-scoped **advisory locks** as static helpers on every record class. They are the preferred way to serialize a specific piece of functionality (a counter decrement, an external API refresh, a background job scheduler) without touching row or table locks, and without blocking any reader or writer that is not participating in the same named lock.

## Why not row locks?

`SELECT ... FOR UPDATE` is a fine tool when the thing you want to protect really is "whatever rows this query touches", but it has two properties that make it unsuitable as a general-purpose serialization mechanism:

1. It blocks **every** subsequent read or write of the same row, not just the function you are trying to serialize. A background job scheduler that takes a row lock on `accounts` to decide whether to enqueue a sync will block an unrelated UI update to the account name.
2. The lock is scoped to whatever SQL happens to touch that row next, not to an identifiable piece of code. Two unrelated features that both lock the same row interact in surprising ways.

Advisory locks take a plain string name. Callers who participate in the same name serialize; everybody else goes unblocked. No rows, columns, or tables are involved.

## API

```js
// Blocking: waits forever (or up to `timeoutMs`), runs the callback, releases in `finally`.
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
// granted within `timeoutMs`. A missing, null, or negative `timeoutMs`
// blocks forever.
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

// Introspection. Useful in diagnostics; callers that want to act on the
// result should prefer `withAdvisoryLockOrFail` to avoid a TOCTOU window.
const isBusy = await Account.hasAdvisoryLock("sync-account-42")
```

Both `withAdvisoryLock` and `withAdvisoryLockOrFail` release the lock in a `finally` block, so the callback's return value is propagated on success and the lock is released on either a thrown error or an early return. Calls without a positive `holdTimeoutMs` acquire and release the advisory lock on the caller's existing database connection/context to avoid extra connection overhead. Calls with a positive `holdTimeoutMs` acquire and release the advisory lock through a dedicated lock connection; the callback keeps using the caller's existing database connection/context. When `holdTimeoutMs` fires, the dedicated lock connection releases the advisory lock before `AdvisoryLockHoldTimeoutError` is thrown.

Each database connection also keeps a counted registry of advisory locks it successfully acquires. Before a checked-out connection returns to its pool, Velocious releases every lock still in that registry so an abandoned critical section cannot leak a session lock into the next checkout. Closing a connection performs the same cleanup before closing the physical database session, including the dedicated connection used by positive `holdTimeoutMs` calls. Cleanup preserves re-entrant acquisition counts and attempts every tracked lock; release failures are surfaced rather than silently leaving a reusable connection poisoned.

## Scope

Database advisory locks are **per session/connection**. Velocious uses the caller connection for ordinary advisory-lock calls and owns a separate lock connection for calls with a positive `holdTimeoutMs`:

- Without a positive `holdTimeoutMs`, the caller connection acquires and releases the named advisory lock.
- With a positive `holdTimeoutMs`, a dedicated lock connection acquires and releases the named advisory lock while the callback runs in the caller's existing database context.
- Opening a **new** connection inside the callback (for example by spawning a child `withConnections` block) does not inherit an ordinary caller-connection lock. It also does not affect a hold-timeout lock's ownership; that lock remains owned by the dedicated lock connection until the helper releases it.
- Nested `Record.withAdvisoryLock(...)` calls with the **same** name can behave differently depending on whether the outer call uses `holdTimeoutMs`. Prefer to avoid nested same-name locks; use `withAdvisoryLockOrFail` if contention should skip instead of waiting.

## Driver support

| Driver        | Implementation                                                                             |
| ------------- | ------------------------------------------------------------------------------------------ |
| MySQL/MariaDB | `GET_LOCK(name, timeout)` / `RELEASE_LOCK(name)` / `IS_USED_LOCK(name)`                    |
| PostgreSQL    | `pg_advisory_lock($key)` / `pg_try_advisory_lock($key)` / `pg_advisory_unlock($key)` with FNV-1a name hashing |
| SQL Server    | `sp_getapplock @LockOwner = 'Session'` / `sp_releaseapplock`                               |
| SQLite        | Process-local emulation: a `Set<string>` of held names plus a per-name waiter queue        |

### PostgreSQL name hashing

PostgreSQL advisory locks are keyed by `bigint`, not by string, so the driver hashes the lock name with 64-bit FNV-1a and passes the resulting signed 64-bit integer to `pg_advisory_lock`. This means two distinct names will almost always map to distinct keys, but the mapping is not cryptographic — do not use advisory locks for security decisions.

### SQLite emulation

SQLite has no native advisory lock primitive, so the SQLite driver ships a process-local emulation backed by a shared `Set<string>` of held names plus a per-name waiter queue. This is the fast path and handles all intra-process contention; it is also the only implementation available to environments without filesystem access (web/sql.js and Expo native).

On **Node**, the Node SQLite driver layers a filesystem lock on top of the in-process queue so multiple Node processes writing to the same SQLite database file see consistent mutual exclusion. Each named lock maps to a directory next to the database file (`<databaseDir>/<databaseName>.velocious-advisory-locks/<safeName>-<hash>.lock/`) created with `fs.mkdir` for atomicity. Inside the directory the driver writes an `owner.json` metadata file with the holder's PID, hostname, and acquisition timestamp.

Stale lock recovery: if the metadata names a PID on this host that is no longer running (`kill(pid, 0) → ESRCH`), the directory is treated as stale and removed by the next acquirer. Cross-host ownership is treated as live because the PID cannot be reliably probed on another machine; operators running Node against a network-mounted SQLite file should remove stale lock directories by hand if they linger.

Web (sql.js) and Expo native inherit the shared in-process implementation unchanged, because they have no `fs` access.

## Errors

- `AdvisoryLockTimeoutError` — thrown by `withAdvisoryLock` when a `timeoutMs` elapses before the lock is granted. Exposes `error.lockName`.
- `AdvisoryLockBusyError` — thrown by `withAdvisoryLockOrFail` when the lock is already held. Exposes `error.lockName`.
- `AdvisoryLockHoldTimeoutError` — thrown by either helper when a `holdTimeoutMs` elapses while the callback is still running. Exposes `error.lockName`.

All three are exported from `velocious/build/src/database/record/index.js` (and the matching source path under `src/`).
