# Advisory locks

Velocious exposes cooperative, connection-scoped **advisory locks** as static helpers on every record class. They are the preferred way to serialize a specific piece of functionality (a counter decrement, an external API refresh, a background job scheduler) without touching row or table locks, and without blocking any reader or writer that is not participating in the same named lock.

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

// Introspection. Useful in diagnostics; callers that want to act on the
// result should prefer `withAdvisoryLockOrFail` to avoid a TOCTOU window.
const isBusy = await Account.hasAdvisoryLock("sync-account-42")
```

Both `withAdvisoryLock` and `withAdvisoryLockOrFail` release the lock in a `finally` block, so the callback's return value is propagated on success and the lock is released on either a thrown error or an early return.

## Scope

Advisory locks are **per connection**. That is the whole point — it is what lets them coexist with row locks on unrelated functionality — but it also means:

- The callback must run on the same Velocious connection that acquired the lock. `Record.withAdvisoryLock(...)` handles this automatically because it reads `this.connection()` from the current async context and uses it for both the acquire and release call.
- Opening a **new** connection inside the callback (for example by spawning a child `withConnections` block) will not inherit the lock. That is rarely what you want.
- Nested `Record.withAdvisoryLock(...)` calls with the **same** name behave differently per driver. MySQL/MariaDB `GET_LOCK` is re-entrant within a session; PostgreSQL `pg_advisory_lock` is re-entrant too but you must release as many times as you acquired; SQL Server `sp_getapplock` is configurable; the SQLite emulation is not re-entrant. Prefer to avoid nested same-name locks instead of relying on driver-specific behavior.

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

Both are exported from `velocious/build/src/database/record/index.js` (and the matching source path under `src/`).
