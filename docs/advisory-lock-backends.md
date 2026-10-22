# Advisory-lock backend chain (design)

Status: **design, partially implemented** (STC-210, parent epic STC-209).

- Tier (d), the opt-in file tier, is implemented (STC-213):
  `src/database/advisory-lock-file-backend.js` behind the runner seam, with per-lock-name
  minimum-tier refusal (`AdvisoryLockMinTierRefusedError`), acquisition provenance, and
  `configuration.getAdvisoryLockBackendStatus(lockName)`.
- Tier (b), the lock server, is implemented as the framework **client adapter**
  (`src/database/advisory-lock-lock-server-backend.js`) speaking the daemon's
  implemented protocol v2 over its websocket surface. Selection is policy-driven
  (`preferredTier: "lock-server"`), an unreachable server fails upward to the driver
  tier with an `advisory-lock-fallback` report, `minTier: "lock-server"` refuses with
  `AdvisoryLockBackendUnavailableError`, and a fenced lease surfaces as
  `AdvisoryLockLostError`. The daemon itself already keeps its authority in process
  memory with leases, FIFO waiters and persisted fencing epochs (STC-212), so this
  leg did not need to reshape it.
- Still open (follow-up legs): the Rollbridge `dedicated` service type for the daemon
  (§11), and per-consumer enablement (TensorBuzz/AwesomeTasks config + policy).

Transport deviation from §6: the daemon was already built and tested on Velocious's
`/websocket` 1:1 connection role (`connection-open` with `params`, `hello-ack`,
correlated responses) instead of a new `JsonSocket` role. The client adapter uses that
implemented surface rather than a second protocol, and the framework keeps the whole
seam (policy, tier cache, errors, telemetry).

This document decides the contract for a **pluggable advisory-lock backend chain** that
prefers a **centralized lock-server process** and falls back to whatever is available,
without ever silently downgrading below a lock name's declared minimum tier.

Current baseline (unchanged by this design): `Record.withAdvisoryLock` /
`withAdvisoryLockOrFail` run on the database driver
(`src/database/advisory-lock-runner.js`, `src/database/drivers/*`). See
[docs/advisory-locks.md](advisory-locks.md) for today's semantics.

## Decision summary

1. The chain is: **process-local pre-filter → lock server (`consens-lock`) →
   driver-native advisory lock → file lock**. File locks are **opt-in only** and never
   default-enabled.
2. The lock server is the **primary cross-host authority**. It keeps all lock state in
   its own process memory — it must **not** consume a database connection while waiting
   or holding (this is a hard acceptance rule, and it means the current consens-lock
   prototype must be reworked; see "What the consens-lock prototype must become").
3. Every acquisition is **attributed to the tier that served it**, reported on the
   acquisition result and on the framework-error channel whenever a fallback lands
   below the lock name's declared preference.
4. Each lock name declares a **minimum tier**; default-deny means undeclared names get
   `driver-native` as their minimum (today's effective behavior), never `process-local`
   or `file`.
5. Fallback is **fail-closed**: a backend outage may only move a lock to a
   stronger-or-equal eligible tier; if none is available the acquisition throws
   `AdvisoryLockBackendUnavailableError` loudly. There is no "no lock" path.
6. Lock-server grants are **leases** with renewal heartbeats and a **monotonic fencing
   epoch per lock name**. A killed holder is detected by TCP close and lease expiry;
   the epoch makes the gap between expiry and re-grant safe.
7. Packaging: publish the daemon as **`@velocious/lock-server`** (renamed from
   `consens-lock-server`) so it deploys independently of each consumer's `velocious`
   pin; the client adapter lives **inside `velocious`**.

## 1. The backend chain and its order

Tiers, strongest cross-host authority first, with the process-local queue as an
always-on pre-filter:

| # | Tier | Scope of mutual exclusion | DB connection consumed while waiting/holding |
|---|------|---------------------------|----------------------------------------------|
| (a) | process-local waiter queue | same process only | no |
| (b) | lock server (`consens-lock`) | cross-process **and** cross-host | no |
| (c) | driver-native (`GET_LOCK` / `pg_advisory_lock` / `sp_getapplock`) | cross-process and cross-host | **yes** (pins a session) |
| (d) | file lock | same host only (shared filesystem at best) | no |

Recommended order and justification:

- **(a) is not a selectable backend.** It stays exactly where it is today — the
  in-process `Set`/waiter queue in `src/database/drivers/sqlite/base.js` — but is
  generalized into a **pre-filter in front of every tier**: before contacting (b) or
  (c), a process first serializes its own concurrent acquisitions of the same name.
  This is free, already proven, and stops same-process stampedes from hitting the
  server or the DB. It is never the authority for a cross-host lock name.
- **(b) is the default authority** for every lock name whose declared minimum allows
  it. It is the only tier that is cross-host *and* connection-free.
- **(c) is the fallback when the lock server is unreachable** and the lock name's
  minimum tier permits it. It is genuinely cross-host (the database server is the
  shared authority) but it pins a pooled connection for the whole hold — the wedged
  `GET_LOCK` pool-drain incident documented in `docs/advisory-locks.md` is why it
  should not be the *preferred* tier for application invariants.
- **(d) is last resort and opt-in.** It is **not enabled by default at all** —
  not for any lock name, not implicitly when other tiers are down. It is enabled only
  by explicit configuration (`advisoryLocks.backends.file.enabled: true` **plus** a
  per-lock-name policy that lists `file` in its allowed tiers), which is the signal
  that the deployment is known to be single-host. A lock name that ends up on (d)
  without both opt-ins is a bug, and the fail-closed rule (§9) makes it throw instead.

Correction to the proposed chain: the ordering (a)→(b)→(c)→(d) is kept, but (a) is
reclassified as a permanent pre-filter rather than a chain member, and (d) is
default-off rather than "enabled when the deployment is known single-host".
"Known single-host" must be an explicit operator declaration, never an inference.

## 2. Capability detection

Detection is **probe once, cache, re-probe on failure** — never a per-acquisition probe:

- **At connect/startup:** when `Configuration` initializes the advisory-lock subsystem
  it probes each configured backend once:
  - lock server: open the socket, send `hello`, wait for `hello-ack` (the same
    readiness-boundary pattern as Beacon's `hello-ack` in `src/beacon/types.js`).
  - driver-native: implied by the configured driver (MariaDB/Postgres/MSSQL support
    is compile-time knowledge; SQLite has no native tier, so (c) is simply absent).
  - file: presence of the filesystem (`fs.mkdir` capability), already the rule for the
    Node SQLite driver.
- **Cached decision:** the result is stored per backend as `available | unavailable`
  with the timestamp and reason. Acquisition path reads the cache — **zero extra
  round trips per acquisition**.
- **Re-probe triggers:** (1) an acquisition failure against the currently selected
  backend, (2) the backend's own disconnect event (socket close), (3) a bounded
  cooldown timer (`reprobeCooldownMs`, default 5000) so a flapping backend cannot
  cause a re-probe per waiting caller. All concurrent re-probes coalesce into one
  in-flight probe promise (the same single-promise coalescing BeaconClient uses for
  its initial connect).
- **Flapping backend and in-flight waiters:** waiters already queued on tier (b) are
  **not** failed when (b) drops mid-wait. On disconnect the runner re-drives each
  waiter against the next eligible tier from the cached decision, preserving the
  remaining `timeoutMs` budget (deadline-relative, not per-attempt). A lock name whose
  remaining eligible tiers cannot satisfy its minimum fails those waiters with
  `AdvisoryLockBackendUnavailableError` instead of downgrading. Exponential-backoff
  reconnect to (b) runs in the background (BeaconClient pattern); when (b) returns,
  new acquisitions prefer it again, in-flight (c) holds are not migrated.

## 3. Fallback must be explicit and observable

Every acquisition carries its provenance:

- **On the result:** the runner records `{backend: "lock-server" | "driver-native" | "file" | "process-local", epoch, fallbackFrom?}` for the held lock. `withAdvisoryLock` passes it to the callback as `args.lockBackend` (additive; existing callbacks ignore it).
- **On fallback:** whenever an acquisition is served by a tier **below the lock name's declared preferred tier**, the runner emits on the framework-error channel — `configuration.getErrorEvents().emit("framework-error", {context: "advisory-lock-fallback", lockName, servedBy, preferredBy, reason})` — matching the repo's "never swallow" rule, so bug reporters see every downgrade. Sustained outage reporting follows the Beacon `unreachableReportMs` grace shape: a single blip that recovers within the grace window is logged, not escalated.
- **Queryable surface:** `configuration.getAdvisoryLockBackendStatus()` returns, per backend, the cached availability, last probe result, current in-use count, and last fallback event; for the lock-server tier it proxies the server's `list`/`who-holds` response (live holders with name, holder id, epoch, lease expiry). This is the "which backend served this lock" surface for diagnostics and system tests.

A silent downgrade to a weaker tier is therefore impossible to hide: it is in the
acquisition result, in the framework-error stream, and in the status surface.

## 4. Safety rule per tier

Implemented (STC-213): the file tier is default-off, only selectable via
`advisoryLocks.backends.file.enabled: true` plus a per-lock-name policy that declares
`minTier: "file"` (or a policy whose minimum is cross-host is refused with
`AdvisoryLockMinTierRefusedError` before any contact with the tier). Holds carry a
`leaseMs` lease renewed on `renewIntervalMs`; a killed holder is reclaimed via lease expiry
or local PID liveness. The tier reports `fencingSupported: false` on every acquisition.

- **(a) process-local:** same process only. A pre-filter, never the authority. No
  cross-host lock name may be satisfied by (a) alone.
- **(b) lock server:** cross-process and cross-host. Authority is the single server
  process; all grant decisions are serialized in it. Consumes no DB connection.
- **(c) driver-native:** cross-process and cross-host, but **pins a database
  connection** for the whole wait+hold. Session-scoped: verified live on MariaDB that
  a session acquiring `probe.a` and then closing leaves `IS_FREE_LOCK('probe.a') = 1`
  for the next session — the DB reclaims the lock when the session dies, which is why
  this tier needs no fencing of its own (the session *is* the lease).
- **(d) file lock:** same host only (and only if the filesystem is shared). Stale-holder
  recovery is PID liveness probing (`kill(pid, 0)`), which is unreliable across hosts —
  this is exactly the weakness the owner directive calls out, and why (d) is opt-in
  last-resort.

**Allowed tiers:** a lock name guarding a cross-host invariant (anything whose
declared minimum is `driver-native` or `lock-server`, which is the default) can
**never** be satisfied by (a) or (d). Enforcement is in the runner before any
acquisition attempt, not as a convention.

## 5. Per-lock-name backend policy

Declaration lives in **configuration** (not naming conventions, not per-call options —
per-call options would let a caller accidentally weaken policy):

```js
new Configuration({
  advisoryLocks: {
    // ... backend config, §10
    policy: [
      {name: "background_jobs:*", minTier: "driver-native", allowedTiers: ["driver-native"]},
      {name: "velocious-attachments-schema", minTier: "driver-native", allowedTiers: ["driver-native"]},
      {name: "tensorbuzz-chained-transition-*", minTier: "driver-native", preferredTier: "lock-server"},
      {name: "my-single-host-thing", minTier: "file", allowedTiers: ["process-local", "lock-server", "driver-native", "file"]},
    ],
  },
})
```

- `minTier` — the weakest tier this name may ever be served by. `lock-server` means
  "cross-host, connection-free only"; `driver-native` means "cross-host is required,
  DB-native fallback permitted"; `file` means "host-local is acceptable" (explicit
  opt-in).
- `allowedTiers` — optional explicit whitelist (used when a name must be DB-native
  because it guards DB-internal work: schema apply, migrations, single-writer DB
  invariants — a lock-server lock cannot serialize DDL against a direct DB client that
  never speaks to the lock server).
- `preferredTier` — the tier used when available; falling below it triggers the §3
  fallback report.
- **Default-deny:** an undeclared name gets `minTier: "driver-native"`,
  `preferredTier: "lock-server"` — i.e. today's cross-host guarantee, with the lock
  server preferred. `process-local` and `file` are never reachable for an undeclared
  name.
- Policy resolution is a longest-prefix glob match computed once per lock name and
  cached (names are hot; matching must not re-scan the policy per acquisition).

## 6. Wire protocol for the lock-server tier

Transport: the same `JsonSocket` framing Velocious already uses for Beacon
(`src/background-jobs/json-socket.js`) — newline-delimited JSON over TCP — but with
**request/response correlation**, which Beacon deliberately lacks. This is a new
socket role, not a Beacon message-type extension: `src/beacon/types.js` already
reserves future roles on the `hello` handshake, so the lock-server connects with
`{type: "hello", role: "lock-client", peerId, peerType}` and receives
`{type: "hello-ack", peerId, serverEpochSource}` as the readiness boundary before any
acquisition is attempted.

Message set (all requests carry a client-generated `correlationId`; every response
echoes it):

| Request | Response | Notes |
|---|---|---|
| `acquire {name, holderId, deadlineAt}` | `acquired {granted: true, epoch, leaseExpiresAt}` / `queued {position}` / `timeout` | Server keeps a FIFO waiter queue per name; `deadlineAt` is absolute so reconnects preserve the remaining budget. |
| `try-acquire {name, holderId}` | `acquired {epoch, leaseExpiresAt}` / `busy {holderId}` | Maps to `withAdvisoryLockOrFail`. |
| `renew {name, holderId, epoch}` | `renewed {leaseExpiresAt}` / `lost {currentEpoch}` | Renewal with fencing check (see §8). |
| `release {name, holderId, epoch}` | `released` / `not-holder` | Idempotent; `not-holder` after an epoch bump is expected, not an error. |
| `who-holds {name}` | `{holderId, epoch, leaseExpiresAt} \| null` | Diagnostics. |
| `list` | `[{name, holderId, epoch, leaseExpiresAt}]` | Feeds `getAdvisoryLockBackendStatus()`. |

Server-side rules: grants are decided only in the server's single event loop (no
database, no second process); a `queued` response lets the client park a local timer
instead of a DB connection; the server pushes `lost {name, epoch}` asynchronously when
a lease expires or a holder disconnects, so a client learns it was fenced without
waiting for its next renewal.

## 7. Leases, not hold-until-release

- **Lease duration:** `leaseMs` (default 30 000, configurable per deployment).
- **Renewal:** the client renews every `renewIntervalMs` (default 10 000 — one third
  of the lease, two missed renewals before expiry) on the same socket. Renewal is a
  `renew` request, not a side effect of traffic.
- **Dead-holder detection: both mechanisms.**
  1. **TCP close** — immediate: on socket close the server releases all leases owned by
     that connection (the proven `unsubscribed()` → `releaseAllLocksForOwner` pattern
     from consens-lock's `locks-channel.js`, and the same shape as
     `releaseDisconnectedLeases` → `scheduleSessionCleanup` in
     `src/testing/shared-transaction-broker.js`).
  2. **Missed heartbeat** — the backstop for a half-open connection (host crashed
     without FIN, network partition): the server expires any lease whose
     `leaseExpiresAt` passed without a successful `renew`, wakes the name's waiter
     queue, and bumps the epoch.
- **Client-side mirror:** if a renewal fails or the socket drops, the client marks the
  hold `lost`, pushes `lost` into the local waiter queue, and — like the broker's
  `rollbackRootSavePoint` step — surfaces it to the holder: the runner throws
  `AdvisoryLockLostError` into the callback's `TimeoutControl`-style cooperative
  cancellation path so the critical section stops as soon as it checks
  `control.check()`/`control.signal`.
- **Shutdown:** `releaseHeldAdvisoryLocks()` gains a lock-server branch: release every
  held lease explicitly, then close the socket (explicit release first, TCP-close
  cleanup as the backstop — same ordering discipline the runner already applies to
  dedicated DB connections).

## 8. Fencing tokens

Because the lock no longer lives in the database session, a network-partitioned
"stale" holder can still be executing. The lock server therefore returns a **monotonic
epoch per lock name**:

- The server keeps `epoch(name)` (integer, incremented on every grant, persisted in the
  server's own durable store so a server restart cannot rewind it).
- `acquire` returns the new epoch; `renew` and `release` must present the holder's
  epoch; presenting a stale epoch returns `lost {currentEpoch}` and the holder must
  treat its critical section as compromised.
- **How the critical section rejects superseded writes:** the callback receives
  `{control, lockBackend, epoch}`. For tier (b) the framework exposes
  `control.fenced()` (cheap boolean, set by the async `lost` push) and the epoch value;
  application writes that matter persist or check the epoch alongside the write (for a
  DB-backed invariant: a `UPDATE ... WHERE lock_epoch = :epoch` style guard row, or
  re-check `control.fenced()` immediately before the committing write). The framework
  cannot fence arbitrary external side effects — the design contract is: **tier (b)
  guarantees at most one *lease holder*; the application guarantees at most one
  *effective writer* by honouring the epoch**, and the framework makes honouring it
  trivial (`lost` push + `control.fenced()` + epoch in the callback args).
- **Tier (c)** does not need fencing: the DB session *is* the lock and dies with it
  (verified MariaDB behavior, §4).
- **Tier (d)** cannot honour fencing: a file lock has no monotonic authority a
  partitioned holder can be checked against (PID probing is unreliable cross-host).
  This is another reason (d) is opt-in last-resort and never satisfies a name with
  `minTier: lock-server`.
- **Tier (a)** needs no fencing (same process; the process either runs or doesn't).

## 9. Fail-closed rule

Exact rule, enforced in the runner before and during acquisition:

1. Eligible tiers for a name = declared `allowedTiers` ∩ configured-enabled ∩
   currently-available (cached probe state), **filtered to tier strength ≥ `minTier`**.
2. Try eligible tiers strongest-first. A backend failure moves to the next **eligible**
   tier — never to an ineligible one, never to "no lock".
3. If no eligible tier is available, the acquisition throws
   `AdvisoryLockBackendUnavailableError {lockName, minTier, probedBackends, reasons}` —
   loud, on the framework-error channel, and distinct from `AdvisoryLockTimeoutError`
   (which means "a backend served the wait and the holder never released").
4. A downgrade attempt below `minTier` is **refused before contacting the weaker
   backend** and reported as `{context: "advisory-lock-min-tier-refused", lockName,
   requestedBackend, minTier}` on the framework-error channel. The refusal itself is
   the loud signal: a multi-host deployment whose lock server is down sees
   `AdvisoryLockBackendUnavailableError` (or a driver-native hold), never a file lock.

Tier strength order: `lock-server` ≡ `driver-native` (both cross-host; `lock-server`
preferred for connection economy) > `file` > `process-local`. `minTier:
"driver-native"` permits (b) and (c); `minTier: "lock-server"` permits only (b).

## 10. Config seam

One `advisoryLocks` block on `Configuration`, mirroring the Beacon shape (config block
+ two env vars + `unreachableReportMs`-style grace), no env-var sprawl:

```js
new Configuration({
  advisoryLocks: {
    backends: {
      lockServer: {enabled: true, host: "127.0.0.1", port: 7340, leaseMs: 30_000, renewIntervalMs: 10_000},
      driverNative: {enabled: true},
      file: {enabled: false},
    },
    policy: [ /* §5 entries */ ],
    reprobeCooldownMs: 5000,
    unreachableReportMs: 30_000,
  },
})
```

- Env vars: `VELOCIOUS_LOCK_SERVER_HOST` / `VELOCIOUS_LOCK_SERVER_PORT` only (same
  pair-shape as `VELOCIOUS_BEACON_HOST`/`VELOCIOUS_BEACON_PORT`). Everything else is
  config-block only.
- `getAdvisoryLockConfig()` resolves defaults exactly like `getBeaconConfig()`:
  explicit config wins over env; `lockServer.enabled` defaults to **true** when a
  lock-server host/port is configured or the env pair is present, and the whole
  subsystem defaults to today's driver-native-only behavior when nothing is configured
  (full backward compatibility: an app that configures nothing behaves exactly as
  before).
- No ad-hoc fallback branches in application code: applications never select a backend;
  the runner does, from this config plus policy.

## 11. Packaging

**Recommendation: publish the daemon as `@velocious/lock-server`** (rename the existing
`consens-lock-server` package; repo stays
`diestoeckels/consens-lock`, package name changes).

Why this option over the alternatives:

- **Not folded into `velocious` as a `velocious lock-server` CLI:** the daemon will be
  shared by TensorBuzz, AwesomeTasks, ticket-app and nemoa on *different* velocious
  pins. Folding it in couples the daemon's deployable version to whichever framework
  version last released it, and a consumer hotfix could force a daemon redeploy or,
  worse, a daemon downgrade. A standalone package lets the operator deploy one daemon
  version independent of every consumer pin — the owner's stated priority.
- **Not keeping the `consens-lock-server` name:** the daemon is part of the Velocious
  ecosystem surface (the client adapter ships in `velocious` and speaks a Velocious
  protocol); the scoped name makes the contract relationship explicit and lets
  `velocious` depend on its wire typedefs if needed.
- **Client adapter stays inside `velocious`** (the seam is framework code — the runner,
  policy resolution, capability cache, and error types all live in the framework).
  `consens-lock-npm-client` remains only as the thin standalone client for
  non-Velocious consumers.

### What the consens-lock prototype must become

The current prototype (`consens-lock-server/src/services/lock-service.js`) is a
starting point, not the target: it persists locks in its own sqlite database via
Velocious records, which (1) violates the acceptance rule that the lock-server tier
consumes no database connection while acquiring/waiting/holding, (2) has a
find-then-create TOCTOU race between two concurrent `obtainLock` calls (only the
unique index saves it, and the code does not handle the resulting conflict), (3) has no
leases, no epochs, no waiting queue, and (4) releases locks only on websocket
unsubscribe. The target daemon: in-memory lock table as the authority (accepting the
documented trade-off that a daemon restart drops current holds — mitigated by leases +
epochs + the §8 fencing contract), FIFO waiter queues, the §6 wire protocol, and TCP
close + lease expiry as the two dead-holder detectors. Epoch persistence is the only
piece that needs durable storage, and it is written on grant only — never while
waiting or holding.

## 12. Compatibility

Must keep working unchanged: `withAdvisoryLock`, `withAdvisoryLockOrFail`,
`AdvisoryLockTimeoutError`, `AdvisoryLockBusyError`, `AdvisoryLockHoldTimeoutError`,
`dedicatedConnection`, `holdTimeoutMs` + `TimeoutControl`, and
`releaseHeldAdvisoryLocks()` on shutdown.

| API | On the lock-server tier | Notes |
|---|---|---|
| `withAdvisoryLock(name, cb, {timeoutMs})` | maps to `acquire` with `deadlineAt` | `AdvisoryLockTimeoutError` unchanged (deadline expiry). |
| `withAdvisoryLockOrFail` | maps to `try-acquire` | `AdvisoryLockBusyError` unchanged. |
| `AdvisoryLockHoldTimeoutError` + `TimeoutControl` | unchanged | Hold timeout is runner-level, backend-agnostic. |
| `dedicatedConnection: true` | **no-op on tier (b)/(d)** | It exists only because a DB advisory lock is session-scoped and needs its own session. On the lock server, ownership is per `holderId` on a framework-owned socket — already independent of the caller's DB connection. Kept as a valid option (ignored) so callers don't break; honored only on tier (c). |
| `hasAdvisoryLock` | maps to `who-holds` | Same TOCTOU caveat as today. |
| `releaseHeldAdvisoryLocks()` | releases held leases + closes socket | Explicit release, TCP-close backstop. |
| SQLite process-local + file emulation | unchanged as tiers (a)/(d) | Existing behavior becomes policy-visible: SQLite-only apps have no tier (c); their undeclared names therefore stay servable by (a) today, and the new `file` tier opt-in replaces today's implicit Node file layer for cross-process SQLite contention. |

New error type: `AdvisoryLockBackendUnavailableError` (§9) and `AdvisoryLockLostError`
(fenced mid-hold, §7/§8). Both exported alongside the existing three.

## Correctness argument (cross-host tiers, including killed holders)

Claim: on tier (b) and tier (c), no two processes can hold the same lock name at the
same time.

**Tier (c).** The database server is a single authority that serializes
`GET_LOCK`/`pg_advisory_lock` on a name internally. A grant is returned to exactly one
session; the name is held until that session releases or the session ends (verified:
session close frees `probe.a`). Two simultaneous holders would require the DB to grant
the same name to two live sessions, which the DB's lock manager forbids by
construction. Killed holder: the session dies (TCP RST/keepalive teardown), the DB
reclaims the lock; the acquisition bound (§ "Acquisition bound" in
`docs/advisory-locks.md`) bounds the worst-case wait while the DB notices.

**Tier (b).** All grant decisions for a name are made in one place — the lock server's
single-threaded event loop — and a grant is an atomic check-and-set in that loop:
`if holders.has(name) → queue/busy; else holders.set(name, {holderId, epoch++})`.
Between the check and the set there is no await, so no interleaving is possible.
Two simultaneous holders would require two decision-makers; there is one.

Killed-holder case on (b): a holder is killed → TCP close → the server's
connection-close handler releases all its leases immediately; if the close is never
observed (crash without FIN, partition), the lease expires at `leaseExpiresAt` without
renewal and the server releases the name and bumps the epoch. In the window between
the holder's death and expiry/release, **no** new grant is issued (the name is still
held) — so there is never overlap; the cost is latency (bounded by `leaseMs`), not
safety. The dangerous case is a holder that is *alive but cut off* (it thinks it holds
while the server has re-granted): the epoch makes this detectable and bounded — the
cut-off holder's next `renew` returns `lost`, and any write it attempts must carry its
epoch, which the critical-section fencing contract (§8) rejects. Mutual exclusion of
*effective writers* therefore holds under the documented fencing obligation; mutual
exclusion of *leases* holds unconditionally.

**Why (a) and (d) are excluded from the claim:** (a) has one process's memory as its
whole universe; (d)'s authority is a filesystem whose stale-holder detection (PID
liveness) is unreliable beyond one host. Neither may serve a name with a cross-host
minimum tier — enforced by §4/§5/§9, not by convention.

## Production lock names → allowed tiers

| Lock name (pattern) | Where used | Purpose | Allowed tiers | Reason |
|---|---|---|---|---|
| `tensorbuzz-chained-transition-*` | TensorBuzz `builds/chained-build-transition-lock-name.js` | Serialize chained build status transitions | min `driver-native`, preferred `lock-server` | Cross-host build invariant; DB fallback acceptable (status rows are DB-internal), but connection pinning is undesirable on hot build paths. |
| `tensorbuzz-account-build-start-*` | TensorBuzz `builds/start-admission-service.js` | Account build-start admission serialization | min `driver-native`, preferred `lock-server` | Cross-host admission invariant, high contention → connection-free tier preferred. |
| statusTransitionLockName (`tensorbuzz-build-status-*` style), `tensorbuzz-crashed-build-*`, `tensorbuzz-boot-instance-*`, `tensorbuzz-build-run-*`, `tensorbuzz-local-parent-runs-*` | TensorBuzz build executor / instance services | Per-build/per-instance state machines | min `driver-native`, preferred `lock-server` | Cross-host invariants over DB rows; DB fallback safe. |
| `background_jobs:*` (migration-scope names, e.g. `background_jobs:handoff_id_column`, schedule-key locks) | Velocious `src/background-jobs/store.js` | Schema-apply and single-writer DB invariants for the jobs store | **`driver-native` only** | Guards DB-internal DDL/state a non-Velocious DB client could race; only the DB's own lock manager sees that client. Lock-server locks would be invisible to direct SQL. |
| `velocious-attachments-schema` | Velocious `src/database/record/attachments/store.js` | Attachment schema apply | **`driver-native` only** | Same: serializes DDL against the database itself. |
| `project_tenant_outbox_drain`, `project-tenant-control:*`, `project_tenant_projection:*`, `sync-replay:task:*`, `project_invoice_saga:*`, task-board list locks | AwesomeTasks backend services | Application invariants (drains, sagas, ordering) | min `driver-native`, preferred `lock-server` | Cross-host app invariants; today MariaDB-native, lock server preferred to free connections. |
| SQLite Node file locks (`<db>.velocious-advisory-locks/*`) | Velocious Node SQLite driver | Cross-process contention on one SQLite file | `process-local` + `file` (opt-in) | Inherently host-local by definition; the only legitimate `file`-tier user. |

## Connection-consumption rule

No tier may consume a database connection while waiting or holding, **except tier (c)**
(itself the driver-native tier). Consequences enforced by this design: the lock-server
daemon keeps its authority in process memory (not in its own Velocious/sqlite tables —
the prototype's current shape must change); tier (a) is pure memory; tier (d) is pure
filesystem; and the client adapter never holds a DB connection while queued on tier
(b).

## Out of scope for this leg

Implementation, migration of the consens-lock daemon to the target shape, wire-format
versioning rollout, and per-consumer enablement (TensorBuzz/AwesomeTasks config
changes) are follow-up legs of STC-209.
