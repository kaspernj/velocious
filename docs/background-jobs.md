# Background Jobs

Velocious background jobs are documented in the main README. This page covers behavior that applications usually need when operating background jobs in production.

For the mounted inspection API, authoritative tab-count snapshots, and
WebSocket/Beacon delta contract, see the
[background-jobs dashboard](background-jobs-dashboard.md).

## Runtime modes and adapters

`backgroundJobs.mode` selects the application-level delivery path and is distinct
from a durable job's `executionMode`:

- `"background"` (default) enqueues through a background-jobs producer. In Node,
  the unchanged default is TCP transport to `background-jobs-main`, the built-in
  SQL adapter, and `executionMode: "pooled"` when a job does not select an
  execution mode. Existing retries, leases, fencing, scheduling, idempotency,
  deduplication, concurrency, pruning, and migrations retain their SQL behavior.
- `"inline"` performs the job immediately in the caller, awaits `perform`, and
  returns an ephemeral `inline-...` performance id. It does not resolve an
  adapter, open a main/worker transport, or create durable queue state. Errors
  propagate to the caller. All `jobOptions` are rejected because their retry,
  scheduling, queue, concurrency, idempotency, deduplication, and worker-execution
  semantics require durable state. `replaceScheduled`, `cancelScheduled`, and
  `rescheduleIn` are rejected for the same reason.

The established `background-jobs/job.js` entry remains the Node entry. It keeps
lazy `src/config/configuration.js` discovery in fresh producer processes and
always sends durable mutations over TCP to `background-jobs-main`, including
when the main uses a custom adapter. This preserves the main's dispatch wake-up
and event-driven idle-worker behavior.

Browser and Expo runtimes use the explicit
`velocious/build/src/background-jobs/platform-job.js` entry. That entry and its
runtime graph contains no Node configuration resolver, server background-job SQL
store, TCP, filesystem registry, process, main, or worker imports. Its configuration must already be current
(call `configuration.setCurrent()`). Inline mode needs no adapter. In background
mode the Browser environment handler owns a built-in local SQLite adapter and
in-process dispatcher; applications statically register portable classes with
`backgroundJobs.jobClasses`. See [Local background jobs](local-background-jobs.md)
for schema, transaction, retry, persistence, lifecycle, and one-adapter-per-database
guarantees. Cloudflare and other environments still require an explicit compatible
adapter.

### BackgroundJobsAdapter contract

Custom background persistence extends the documented base class:

```js
import BackgroundJobsAdapter from "velocious/build/src/background-jobs/adapter.js"

class ApplicationJobsAdapter extends BackgroundJobsAdapter {
  // Implement the lifecycle and queue operations described below.
}

export default new Configuration({
  // One caller-provided instance, reused if a later lifecycle resolves it again:
  backgroundJobs: {adapter: new ApplicationJobsAdapter()}

  // Or a fresh instance per lifecycle:
  // backgroundJobs: {adapter: ({configuration}) => new ApplicationJobsAdapter({configuration})}
})
```

Adapter factories are synchronous. A configuration memoizes one resolved adapter,
shares one successful `ensureReady()` phase, and atomically acquires that exact
ready instance for an operation. Close is serialized against acquisition: if
close claims an adapter while readiness is pending, the acquisition waits for
close and readies the next lifecycle instead of mutating a closed generation.
`closeDatabaseConnections()` calls `close()`, and concurrent close calls share
that close. After close, a factory is invoked again on the next use; a configured
instance is resolved again, so an instance intended for repeated lifecycles must
support readiness after close. A stopped main clears its adapter reference and
acquires the current ready generation again on every `start()`.

The current main/worker architecture requires these adapter operations:

- lifecycle/readiness: `ensureReady`, `health`, and `close`;
- enqueue and stable schedules: `enqueue`, `replaceScheduled`, and
  `cancelScheduled`;
- dequeue and timing: `nextAvailableJob`, `nextScheduledJob`,
  `reconcileQueueConcurrency`, and `reconcileActiveConcurrency`;
- start/handoff state: `markHandedOff`, `markReturnedToQueue`,
  `handedOffJobsForWorker`, `snapshotHandedOffJobs`, and
  `markOrphanedHandoffs`;
- success/failure state: `markCompleted`, `markRescheduled`, `markFailed`, and
  `markOrphanedJobs`;
- built-in maintenance: `getJob` and `pruneTerminalJobs`.

Methods that accept worker reports must preserve the existing lease-fencing and
at-least-once semantics. `health()` returns `{ready: boolean}`; the mounted health
endpoint reports `503` when an adapter explicitly reports `ready: false`.
`reconcileActiveConcurrency()` returns checked/candidate/repaired counts plus a
bounded repair sample. The base adapter returns an empty result for adapters
that do not duplicate active counts outside their job rows.

`background-jobs-main` calls
`markHandedOff({jobId, handoffId, workerId})` with a caller-generated
`handoffId`. A custom adapter must atomically persist that exact id when it wins
the queued-to-`handed_off` transition and return it in the
`BackgroundJobHandoff`. This lets the main safely call
`markReturnedToQueue({jobId, handoffId})` when the claim throws after an
ambiguous commit: the return either releases that exact lease or does nothing if
the claim never committed or a newer lease now owns the job. The built-in SQL
and local adapters still generate an id when legacy direct callers omit it, but
a custom adapter used by the main must honor a supplied id. Upgrade that adapter
implementation together with the Velocious main; the worker wire protocol is
unchanged.

Main-generation recovery uses `snapshotHandedOffJobs()` before the new TCP
listener accepts worker reconnects. A custom adapter that persists worker leases
must return only complete exact identities (`jobId`, `handoffId`, `workerId`, and
`handedOffAtMs`) and implement `markOrphanedHandoffs({handoffs, error})` as an
atomic fenced orphan/failure transition. That transition must preserve normal
retry attempts, terminal orphan status, count updates, concurrency release, and
schedule ownership. The base implementations return no snapshots and perform no
transitions, which preserves compatibility for adapters that do not persist
worker handoffs; overriding snapshot collection without its matching fenced
transition is invalid.

The built-in adapter is available at
`velocious/build/src/background-jobs/sql-adapter.js`. It subclasses the existing
`BackgroundJobsStore`, so existing direct store imports and every current SQL
migration/queue semantic remain compatible. The SQL adapter also owns the
framework-schema migration hook; a custom adapter may override
`ensureFrameworkSchema({dbs})` when it owns framework persistence, while the base
implementation is a no-op.

This seam is intentionally bounded. Dashboard list/stats storage and specialized
mailer delivery-operation SQL remain direct `BackgroundJobsStore` consumers;
only dashboard health is adapter-aware. Supplying a generic adapter does not make
those SQL-specific features portable. No Cloudflare Workers implementation or
package root/export-map alias is included here.

## Execution modes and pooled runners

New enqueues default to `executionMode: "pooled"`. Each worker owns a local pool of warm Node child processes; a child runs up to `pooledRunnerConcurrency` jobs at a time on its own event loop and is reused for sequential jobs. Completion still flows through the runner's durable status reporter, so the main process and database acknowledgement remain authoritative. Pooled capacity is advertised explicitly and is separate from inline and forked/spawned capacity. The `execution_mode` column is the single source of truth for a job's runtime — pooled rows persist as `execution_mode = "pooled"` directly.

Concurrent jobs entering a cold pooled child share one complete configuration and
model-bootstrap promise. A bootstrap error is reported to every job waiting on
that attempt and is not hidden or converted into job success. If the warm child
later receives more work, configuration initialization starts a complete new model
phase before loading or performing the job; a failed earlier phase cannot leave
the child marked model-ready. This preserves configured pooled concurrency while
preventing synchronous queries such as `Model.where(...)` from observing partial
record metadata.

Set `backgroundJobs.pooledRunnerCount` (default `4`) to bound the per-worker pool. Set `backgroundJobs.pooledRunnerConcurrency` (default `1`) to run several jobs on each child at once: total per-worker pooled capacity is `pooledRunnerCount × pooledRunnerConcurrency`. `1` keeps each child serial; raise it for I/O-bound jobs so a bounded set of isolated processes handles high concurrency (like the inline lane) without one process per concurrent job. A single job's unexpected failure is reported for reclamation without taking down the child or its concurrent siblings; only a process-level crash fails the whole in-flight set. `pooledRunnerCount`, `pooledRunnerConcurrency`, and `pooledRunnerMaxJobs` must be finite positive integers; the RSS and lifetime limits must be finite positive numbers. Invalid values fall back to their defaults. A runner is retired after an acknowledged terminal report when it reaches `pooledRunnerMaxJobs` (default `100`), child-measured `pooledRunnerMaxRssBytes` (default `536870912`, or 512 MiB), or `pooledRunnerMaxLifetimeMs` from child creation (default `3600000`, or one hour). Retirement never interrupts in-flight jobs: the child stops receiving new work, its replacement is spawned immediately (1-for-1, so capacity does not wait for the drain), and the retiring child is terminated only once its in-flight set drains. Exited, unacknowledged, or unhealthy runners immediately re-advertise their freed capacity after startup, while the replacement is still spawned lazily by the next dispatch; a runner that exits before its startup handshake does not re-advertise, preventing a startup respawn loop. Failure reports remain tracked and are drained during graceful shutdown, but a slow fallback report no longer blocks reuse of the freed runner capacity. Graceful worker shutdown stops advertising capacity, drains current pooled jobs and reports, and then terminates every idle child within the existing shutdown bounds.

Set the runtime explicitly with `executionMode` — `"pooled"` (default), `"inline"`, `"forked"`, or `"spawned"`. There is no `forked` option; a store upgrade migrates any legacy `forked`-flagged rows to their `execution_mode` and drops the column.

For delayed one-off work, see [Scheduling One-Off Background Jobs](scheduled-background-job-enqueue.md). Recurring schedules use the separate `scheduledBackgroundJobs` configuration described in the [README](../README.md#scheduled-jobs).

Logical one-off schedules that may be moved or cancelled can use `replaceScheduled` and `cancelScheduled` with a durable stable key. Queued replacement/cancellation is atomic across processes; a `handed_off` result is explicitly best-effort because running JavaScript is not interrupted. Consumers must pair the API with their own generation/revision check immediately before side effects. See [Replacing or cancelling a logical schedule](scheduled-background-job-enqueue.md#replacing-or-cancelling-a-logical-schedule).

## Rescheduling a running job

Use `this.rescheduleIn(delayMs)` when a running job cannot proceed yet but has not
failed, such as when a non-blocking application lock is already held:

```js
export default class RefreshAccountJob extends VelociousJob {
  async perform(accountId) {
    if (!(await Account.tryAcquireRefreshLock(accountId))) {
      this.rescheduleIn(30_000)
    }

    await refreshAccount(accountId)
  }
}
```

The delay must be a finite, non-negative safe integer in milliseconds. The method
never returns: it ends the current performance, atomically returns the same
durable job row to `queued`, schedules it relative to the time that transition is
persisted, and releases both the executing worker slot and any durable concurrency
reservation. The row keeps its id, arguments, queue, execution mode, stable
schedule ownership, attempts, and failure metadata.

Rescheduling is normal control flow and is deliberately separate from throwing an
error. It does not consume `maxRetries`, increment `attempts`, set `lastError`, or
emit `background-job-failed` / `all-error`. An invalid delay is an ordinary
programming error and therefore follows normal job failure and retry behavior.
Independent enqueues remain independent: rescheduling does not insert, merge, or
delete rows, and `deduplicateWhileQueued` keeps its existing enqueue-time rules.

When pooled capacity admits the rescheduled row before the prior terminal
acknowledgement reaches its worker, the worker serializes both leases by durable
job ID. The next run starts only after the prior acknowledgement settles, while
different job IDs can still use the pool concurrently.

## Database connection scopes

By default, a job receives the existing Velocious behavior: every active configured database is checked out for the duration of `perform`. Jobs that need a known subset should declare it on the job class:

```js
export default class RefreshAccountJob extends VelociousJob {
  static databaseIdentifiers = ["default"]
}
```

The declaration applies to inline, forked, spawned, and pooled execution. Use `[]` for jobs that do not query through the ambient connection scope or that establish narrower scopes themselves. Leaving `databaseIdentifiers` undefined preserves all-database behavior for compatibility.

## Durable concurrency limits

Pass `concurrencyKey` and `maxConcurrency` together in `jobOptions` (or in `performLaterWithOptions`). The key is an opaque, non-empty string shared by jobs that use the same limit, and the cap is a positive integer. Omitting both preserves unlimited behavior. Once a key is registered, every enqueue for that key must use the same cap; a conflicting cap is rejected.

A job may instead derive its key from its hydrated instance context. Override the synchronous, non-static `concurrencyKey()` method and read `this.backgroundJobContext()`, which exposes `jobClass`, `jobName`, serialized `args`, resolved `options`, and (while performing) the complete persisted `payload`. Constructors receive no context arguments.

```js
export default class RefreshDiskJob extends VelociousJob {
  concurrencyKey() {
    const [serverId] = this.backgroundJobContext().args
    return `docker-server-available-disk-refresh:${serverId}`
  }
}

await RefreshDiskJob.performLaterWithOptions({
  args: [serverId],
  options: {maxConcurrency: 1}
})
```

The method is resolved before admission/persistence and its result uses the existing durable limiter. A derived key must therefore still be paired with `maxConcurrency`. An explicit enqueue `concurrencyKey` overrides the derived key (and skips the method); explicit `queue` likewise overrides `static queue`.

Limits are enforced by durable database reservations shared by every main/worker process. Saturated keys do not prevent unrelated queued jobs from being dispatched. Reservations are released when work completes, fails terminally, is requeued for retry, is cancelled, or is recovered as orphaned. Startup reconciliation rebuilds reservation counts after an unclean scheduler stop, and the active main rechecks them on its one-minute maintenance cadence so drift cannot keep work queued until another restart. Healthy checks use two aggregate reads and no counter writes; suspected mismatches are re-counted under their per-key locks, and actual repairs emit a structured warning with a bounded key sample before dispatch is retried.

## Queues (per-queue concurrency caps)

Give a job class a queue with `static queue = "..."` (or pass `{queue}` in job options — the option wins). A job with no queue runs on `"default"`. Configure a cluster-wide cap per queue under `backgroundJobs.queues`:

```js
backgroundJobs: {
  queues: {
    buildPlanner: {maxConcurrent: 2, priority: 20}, // small, time-critical: always dispatched first
    githubWebhooks: {maxConcurrent: 20, priority: 10},
    builds: {maxConcurrent: 100}, // I/O-bound work can run well above the core count
    default: {maxConcurrent: 8}   // priority defaults to 0
  }
}
```

Each capped queue is enforced through the same durable per-key concurrency mechanism described above: a job on the queue is given the reserved concurrency key `queue:<name>`, so `queues[name].maxConcurrent` bounds how many jobs from that queue run in flight across every main/worker process, regardless of how many processes run. A queue with no configured cap is unlimited.

- The `queue:` concurrency-key prefix is reserved — an explicit `concurrencyKey` may not start with it.
- Caps are config-driven and tunable. Adding, removing, or changing `queues[name].maxConcurrent` is reconciled against queued backlog rows when the main process starts. Already handed-off jobs keep the concurrency policy and reservation recorded when they started, then release it through their normal terminal/requeue transition; this prevents a startup policy update from racing an in-flight handoff or report. New handoffs fence the concurrency key they selected, so a concurrent policy update wins cleanly and the job is selected again under its new policy. Startup reconciliation is serialized across processes with a database advisory lock and logs its database identifier and duration. The active main shares that lock for its lightweight one-minute active-count repair. Schema/tenant checks (`db:migrate`, `db:tenants:*`) and routine store/connection initialization with an intact jobs table never adopt jobs or rebuild global concurrency counts, so repeated checks cannot issue the broad concurrency UPDATEs that deadlock against active job processes. If schema repair recreates a physically missing `background_jobs` table while the migration marker and concurrency table survive, it resets the surviving active counts against the newly empty jobs table so stale capacity cannot block future dispatch.
- Scheduled jobs (`scheduledBackgroundJobs`) honor a job class's `static queue` as well.
- Graceful `background-jobs-main` shutdown drains scheduled enqueues that have already fired before it closes database connections. Once shutdown resolves, that scheduler can no longer add rows during a subsequent application or test lifecycle.

### Priorities

`queues[name].priority` (default `0`) makes the main process dispatch higher-priority queues before lower-priority ones, regardless of when each job was enqueued. This keeps a small, time-critical queue (a build planner, webhook processing) from being starved by a flood of low-priority work that shares the same worker pool — the exact failure that an under-sized single `default` queue produces: side-effect noise crowds out the jobs that actually move the pipeline forward.

Unlike Sidekiq's strict queue ordering, priority **composes with the per-queue caps**: a higher-priority queue that is already at its `maxConcurrent` is skipped, and dispatch falls through to the next eligible lower-priority job. So a busy high-priority queue can't block everything behind it — it only wins while it has spare capacity. Priorities may be any number (negative sinks a queue below the default), and jobs within the same priority keep FIFO (`scheduled_at`, then `created_at`) order. Priority ordering applies only to the dispatch decision; it does not reorder future-scheduled jobs, which stay strictly time-ordered.

The cap-fallthrough guarantee is a property of the **queue-derived** cap. A job that supplies its own explicit `concurrencyKey`/`maxConcurrency` bypasses the queue cap entirely — an explicit key always wins (see above) — so it is bounded only by that explicit key, not by `queues[name].maxConcurrent`. Such a job is therefore never held back by the queue's cap; priority just orders it normally against the rest. If you want a job to be bounded by both a queue cap and a finer-grained key, model the finer-grained limit as its own queue rather than an explicit `concurrencyKey`.

## Enqueue deduplication

`deduplicateWhileQueued: true` coalesces an enqueue by job identity: job name, serialized arguments, and queue. It returns the earliest identical queued job only when that job is scheduled no later than the new enqueue. This preserves one queued copy for repeated immediate or recurring triggers, but a failed job whose retry is backed off into the future cannot block fresh immediate work.

Recurring schedule ticks finish their enqueue lifecycle once the job is durably
stored and workers have been notified. Dispatch is requested separately through
the main process's coalesced drain. A slow dispatcher drain therefore cannot
suppress future timer ticks; queued deduplication and durable concurrency limits
continue to enforce the configured logical-job overlap policy.

## Durable idempotent enqueue

Pass a producer-owned stable `idempotencyKey` when replaying one logical enqueue must return the original job rather than create another one:

```js
const jobId = await PublishEventJob.performLaterWithOptions({
  args: [eventId, eventRevision],
  options: {idempotencyKey: `publish-event:${eventId}:${eventRevision}`}
})
```

The durable ownership scope is the tuple of resolved job class name, resolved queue, and caller key. The first enqueue atomically creates the ownership row and job row. Concurrent first enqueues converge through the database's unique ownership key. An exact replay returns the original job id while the job is queued, running, completed, failed, cancelled, or orphaned, and continues returning that id after terminal-job retention prunes the job row.

The Node TCP producer waits at most 5 seconds for the main process's `enqueued`
acknowledgement. A connection error, a peer that ends or closes before the
acknowledgement, or a stalled acknowledgement rejects the producer call and
tears down its one-shot socket. Persistence may already have committed when the
acknowledgement is lost, so this rejection is deliberately an ambiguous outcome,
not proof that no job exists. Replay the same request with the same
`idempotencyKey`: durable ownership returns the already-persisted job id instead
of creating a second job. Replaying an enqueue without a durable idempotency key
can create another job. Direct users of the Node `BackgroundJobsClient` may pass
`enqueueTimeoutMs` to its constructor to use a different bounded deadline.

The owned request includes the serialized arguments and behavior-affecting enqueue options: resolved queue, execution mode, retry cap, resolved concurrency configuration, and immediate-versus-scheduled timing. Reusing the same scope with a different canonical request fails with a safe `background-job-idempotency-conflict` error. Generated job ids and the wall-clock timestamp of an immediate enqueue are not request identity. `deduplicateWhileQueued` is also not identity: it remains the separate, transient queued-row optimization described above.

Idempotency ownership rows are intentionally not pruned in this release, and ordinary terminal-job retention never deletes them. Operators should treat keys as permanent until Velocious gains a separate, explicit reconciliation and deletion policy; deleting ownership without proving that its external operation can no longer be replayed can recreate duplicate work.

## Retention (pruning old job rows)

Terminal job rows are not deleted automatically unless retention is configured — a busy application otherwise accumulates `completed` (and `failed`/`orphaned`) rows indefinitely, bloating the table and its indexes and eventually slowing dispatch. Configure retention under `backgroundJobs.retention`:

```js
backgroundJobs: {
  retention: {
    completedTtlMs: 7 * 24 * 60 * 60 * 1000, // delete completed jobs older than this (default: 7 days; null/0 disables)
    failedTtlMs: 30 * 24 * 60 * 60 * 1000,   // delete failed/orphaned jobs older than this (default: 30 days; null/0 disables)
    batchSize: 1000,                          // rows deleted per batch (default: 1000)
    sweepIntervalMs: 60 * 60 * 1000           // how often the prune runs (default: 1 hour)
  }
}
```

When at least one TTL is enabled, `background-jobs-main` registers a built-in `velocious:prune-terminal-background-jobs` job on the scheduler. **It runs as an ordinary background job**, so:

- it requires a running worker to execute — a stopped worker pool means no pruning until one returns;
- each run appears in the job tables as a normal queued job and can retry or fail like any other job;
- runs are bounded — a `maxConcurrency: 1` reservation prevents overlap, and enqueue-time deduplication keeps the recurring schedule from piling up redundant queued rows when a prune runs slower than its interval or no worker is free.

Deletion is batched by id (`SELECT` a page, then `DELETE ... WHERE id IN (...)`) so a large backlog is removed incrementally rather than in one long transaction. Retention only ever deletes terminal rows; `queued` and in-flight jobs are never pruned. Durable idempotency ownership and mail-operation rows are independent of job retention and are not deleted by this sweep.

## Worker Disconnect Recovery

Each durable worker handoff has a unique lease id. In legacy mode, if a worker
socket disconnects unexpectedly, `background-jobs-main` immediately returns
only the jobs handed to that exact socket to the queue. In release-generation
mode, the main retains those exact leases for the configured reconnect grace and
accepts only the same generation-qualified worker identity back on its old
endpoint. Grace expiry returns the exact leases to the global queue. A late
report is fenced by generation-qualified worker id, handoff id, and handoff
timestamp, so it cannot mutate a newer attempt. Two legacy connections that
advertise the same worker id remain isolated from each other.

The main chooses the lease id before persistence. If `markHandedOff` throws, it
conditionally returns only that id, including when the database committed but
the acknowledgement was lost. A failed recovery read/return stays in the main's
recovery ledger and is retried through the dispatch error-retry path; a later
lease is never selected by timestamp or worker id and therefore cannot be
requeued by the stale recovery. Because no job reached the selected worker, its
consumed admission is restored only while that exact socket remains connected
and non-draining. A readiness advertisement received during persistence is
authoritative, so pooled capacity is not double-credited.

Disconnect recovery provides at-least-once delivery: a disconnected worker may already have started external side effects before the replacement attempt begins. Completion and failure reports carry the lease id and update the database only while that exact handoff is still active, so a late report from the disconnected attempt cannot complete or fail a newer attempt.

An explicitly stopped legacy worker preserves the established terminating-stop
behavior. Release-generation retirement instead revokes readiness immediately
while keeping the worker heartbeat and old endpoint connection alive until its
accepted jobs, child runners, durable report retries, and acknowledgements have
settled. If that connection is lost during the drain, only the same qualified
worker identity may reconnect to the unchanged old endpoint during reconnect
grace; a retiring or recovered retired main reasserts `retire`, grants no
readiness, and keeps the exact handoffs owned. A new or mismatched worker is
rejected. The worker finally stops heartbeat/reconnect only after the exact
drain completes.

The fenced protocol uses an explicit worker handshake capability. A main process that creates lease ids dispatches new jobs only to workers advertising handoff-id reporting; older workers remain connected so they can report legacy handoffs that have no lease id. During a rolling upgrade, upgrade workers before the main process to avoid pausing new dispatch while only legacy workers are connected.

An unexpected **main** restart can use a bounded worker-reconnect recovery. Before listening, the replacement main snapshots only complete lease-aware `handed_off` rows. A surviving worker reconnects with its stable id (`hello`), and the main queries and adopts its still-active handoffs into the new socket's lease map. When reconnect grace expires, reclaim first waits for the fixed set of adoption queries already in flight at that deadline. That wait is capped at one additional reconnect-grace interval, so an ordinary slow query can finish without racing reclaim while a stuck adapter query cannot block startup cleanup forever. The worker id is excluded from startup reclaim only after its adoption query succeeds while the same socket is still connected. A rejected query, a socket lost during the query, or a query still stuck after the bounded wait remains eligible for the startup reclaim pass. If a successfully adopted worker later disconnects, those leases are released like any other; while it remains connected, they are untouched.

This adoption path is crash/legacy recovery, not normal deployment draining. A
normal release deploy must keep the old main alive on its old endpoint with the
workers and handoffs it already owns. Old workers must not reconnect to or be
handed over to the candidate main. An integration that restarts jobs-main on
every deploy and relies on this adoption path does not implement the required
release-generation contract below.

After a 30-second reconnect grace, the main passes only snapshots belonging to worker ids that did not successfully adopt through a still-live connection to the store's orphan transition. Every update is fenced on the exact startup `jobId`, `handoffId`, `workerId`, and `handedOffAtMs`. A lease completed or returned during the grace, re-handed-off under a newer lease, created after startup, or owned by any worker that successfully adopted cannot be reclaimed. Accepted rows use the ordinary orphan failure lifecycle: attempts and status counts update, retries keep their configured backoff, terminal rows become `orphaned`, concurrency reservations and schedule ownership are released correctly, `background-job-orphaned` events fire, and the queue is awakened so newly unblocked work can dispatch. Legacy rows without a complete exact lease identity remain under the two-hour age sweep. This is at-least-once recovery: a worker process that stayed alive but could not reconnect before the grace may still have performed external side effects, so jobs requiring exactly-once effects must use application-level idempotency.

## Worker Liveness

Disconnect recovery above depends on the worker's control socket firing a `close` event. A worker that wedges while alive — or a half-open TCP connection — never fires `close`, so its leases (and, if it is the only worker, the whole queue) would stay stuck until someone intervened. Two mechanisms make this self-healing:

- **Heartbeats.** A worker advertises `supportsHeartbeat` in its hello and then sends a periodic `heartbeat` (default every 15s); the sockets also enable TCP keepalive. The main records the last time it saw any message from each worker and, on a periodic sweep, drops a heartbeat-capable worker that has been silent longer than `workerStaleTimeoutMs` (default 60s) — releasing its leases so its jobs run elsewhere and it stops receiving new work. A worker that does **not** advertise heartbeat support (for example an older release mid rolling deploy) is exempt from stale eviction and is only reclaimed through the `close`-based path, so its in-flight leases are never released while it is still running them.
- **Decoupled, durable reporting.** Freeing a worker's job slot never waits on reporting the result to the main. When a job (inline or forked) finishes, its slot is released immediately and the completion/failure report is sent in the background and retried durably until it lands. A transient main/DB outage therefore can neither leak worker slots (which previously drove the worker to stop accepting jobs) nor lose a terminal report and re-run already-completed work. A graceful `stop()` drains in-flight reports before closing the socket.
- **Readiness re-announcement.** Pooled workers advertise an exact available-slot count, which the main consumes once per durable handoff so a single readiness message can fill the configured concurrent pool without waiting for an earlier job to finish. The worker refreshes that count on every completion and immediately after an initialized child exits, even while its failure reports retry. Forked, spawned, and inline readiness remains edge-driven: the main removes a worker from its ready set on dispatch and the worker re-announces every freed slot. These advertisements correspond only to real capacity, so no polling timer or speculative handoff is required.

Heartbeat interval, stale timeout, liveness sweep interval, and the startup
`workerReconnectGraceMs` are overridable via the worker/main constructors for
tests and tuning. The reconnect grace defaults to 30 seconds and must be an
integer from 0 through Node's maximum timer delay of 2,147,483,647 ms; the main
constructor throws for invalid values instead of allowing an overflowing timer
to fire immediately. Its timer is unrefed and is cleared during main shutdown.

## Process titles

Every velocious process sets a descriptive `process.title`, so `ps`/`top`/`htop` identify it instead of showing a wall of generic `node` entries — essential for seeing which processes and jobs consume CPU/RAM in production:

- The long-lived daemons are named `velocious background-jobs-main`, `velocious background-jobs-worker`, `velocious server`, and `velocious beacon`.
- Each forked or spawned **job runner** is named after the job it is executing, so a single `ps aux` snapshot shows which jobs are live and how many runners each holds.

By default a runner is titled `velocious job-runner: <JobName>`. A job class can declare a custom, human-readable title:

```js
export default class TranscodeMediaJob extends VelociousJob {
  static processTitle = "velocious media transcoder"
}
```

Velocious sets the job's title for the duration of the job and restores the runner's base title (`velocious background-jobs-runner`) in a `finally` when the job finishes, so a lingering or reused runner never misreports a completed job as still running. `ps aux`/`top` show the full title; only the 15-character `comm` column truncates.

## Failure Events

`background-jobs-main` emits a `background-job-failed` error event after it accepts a worker failure report and records the updated job state. Duplicate or stale worker reports do not emit this event because they are rejected before the job row changes.

The event fires for every accepted failed attempt, including attempts that are returned to the queue for retry and attempts that end the job.

```js
configuration.getErrorEvents().on("background-job-failed", ({error, context}) => {
  console.error("Background job failed", {
    error,
    jobId: context.jobId,
    jobName: context.jobName,
    terminal: context.terminal,
    willRetry: context.willRetry
  })
})
```

Applications that already listen to the aggregate error stream can handle the mirrored event there:

```js
configuration.getErrorEvents().on("all-error", ({error, errorType, context}) => {
  if (errorType !== "background-job-failed") return

  console.error("Background job failed", error, context)
})
```

The `background-job-failed` payload has:

- `error`: the job failure as an `Error`. String failure reports are normalized to an `Error`, with the original string preserved as `error.stack` when available.
- `context.attempts`: the updated failed-attempt count after this report.
- `context.handoffId`: the unique handoff lease id included in the accepted report.
- `context.handedOffAtMs`: the worker handoff timestamp included in the accepted report.
- `context.jobArgs`: the serialized arguments for the job.
- `context.jobId`: the background job id.
- `context.jobName`: the job class name.
- `context.maxRetries`: the job retry limit.
- `context.stage`: always `"background-job-failed"`.
- `context.status`: the persisted job status after failure handling, such as `"queued"` for a retry or `"failed"` for an exhausted job.
- `context.terminal`: whether this failure ended the job.
- `context.willRetry`: whether this failure returned the job to the queue.
- `context.workerId`: the worker id included in the accepted report.
- `context.runnerFailure`: present when a pooled runner process failure affected
  this job. Every job lost with the same child receives the same snapshot. It
  contains `activeJobs` (job, handoff, timestamp, and worker identities), the
  runner and worker PIDs, release generation, runner/worker lifecycle states,
  runner age and completed-job count, process-group ownership through
  `runnerDetached`, failure `origin`, expected `terminationReason`, timeout job
  id, exit code, signal, and `oomKilled`.

`oomKilled` is `false` when Velocious initiated or observed a termination that
rules OOM out. It is `null` for an unexplained `SIGKILL`, because Node cannot
distinguish an operator/supervisor kill from the kernel OOM killer; correlate the
snapshot with supervisor and kernel logs before classifying it. Pooled runners
are attached children (`runnerDetached: false`) and therefore remain in the
worker-owned process group rather than creating an independently supervised
group.

The mirrored `all-error` payload includes the same `error` and `context` plus `errorType: "background-job-failed"`.

### Orphaned jobs

`background-jobs-main` also emits a `background-job-orphaned` error event (mirrored to `all-error` as `errorType: "background-job-orphaned"`) for each job its time-based orphan sweep reclaims — a job whose worker died mid-run and stopped reporting, so it was stuck `handed_off` past the orphan timeout. Unlike `background-job-failed`, which fires on a worker's failure report, this fires from the main process's sweep, so an application can react to the specific job a dead worker left behind — enqueue a targeted recovery for the work it was doing — instead of only polling for the aftermath. The sweep emits these events before waiting for reclaimed jobs to be dispatched, so a stalled dispatcher does not delay application recovery handlers.

```js
configuration.getErrorEvents().on("background-job-orphaned", ({error, context}) => {
  if (context.jobName !== "RunBuildJob") return

  // context.jobArgs are the orphaned job's serialized arguments.
  enqueueTargetedRecovery(context.jobArgs[0])
})
```

The `background-job-orphaned` payload mirrors `background-job-failed`: `error` (the orphan reason as an `Error`) and `context` with `attempts`, `jobArgs`, `jobId`, `jobName`, `maxRetries`, `status`, `terminal`, `willRetry`, and `stage: "background-job-orphaned"`. `willRetry` is `true` when the reclaim returned the job to the queue for another attempt (retries remaining) and `false` when it was exhausted into a terminal `orphaned` state.

An unexpected live concurrency-reconciliation failure is emitted as
`framework-error` and mirrored to `all-error` with
`context.stage: "background-job-concurrency-reconciliation"`. It does not
suppress orphan processing on the same maintenance pass.

## Release-generation draining

In a release-directory production topology, a runtime generation consists of one
release-scoped `background-jobs-main` plus its worker pool. This behavior is
required:

1. Start the complete candidate jobs generation before candidate activation in a
   pre-activation quiescent state. Its main and workers may initialize, connect,
   and prove health, but the candidate main does not own recurring schedules,
   dispatch queued work, or issue handoffs, and its workers do not accept
   handoffs.
2. As part of the fenced activation transition, revoke the old main’s recurring
   schedule ownership, queued-work dispatch, and new handoffs before the
   candidate main acquires those responsibilities. Only the active generation
   may own scheduling and dispatch. The old workers stop accepting handoffs in
   the same transition.
3. After activation, retire the old main and workers as one unit. Keep the old
   main running on its old endpoint with its old workers. It
   continues owning worker connections and heartbeats, lease fencing, terminal-
   report acceptance and acknowledgement, and durable store transitions for
   every handoff it made.
4. Keep the old workers and their reporting paths bound to that endpoint. They
   continue owning durable terminal-report retry and report-promise draining,
   per-job timeout execution, and child-runner reaping until their work settles.
5. Work returned or retried to the shared queue becomes eligible for the new
   active generation; the retired main never dispatches it again. Old workers do
   not reconnect or transfer handoffs to the new main.
6. Exit the old main only after all of its handoffs settle and all of its workers
   drain and exit. The supervisor may then reap the generation and release the
   old release's cleanup pin.

Generations may overlap for hours and use different jobs-main endpoints while
sharing durable queue storage and, optionally, Beacon. Multiple retired
generations may drain concurrently. The process supervisor must durably preserve
their identities, endpoints, owned processes, and release references across
later deploys and supervisor/host recovery.

Deployment succeeds after the candidate release is activated and healthy. The
deploy command and deploy lock do not wait for retired jobs generations, jobs,
workers, HTTP/WebSocket connections, or other retained services. HTTP/WebSocket
drain is independent: completing or timing it out must never kill a still-
draining jobs generation. Runtime-owner/version replacement likewise preserves
or transfers durable supervision and returns after the replacement is healthy;
it is not a full synchronous shutdown.

Velocious now supplies this opt-in jobs-generation protocol and lifecycle. It
does not by itself make a production deploy topology compliant: Rollbridge (or
another supervisor) must still start and retain each release-local main/worker
unit, preserve it through later deploys and runtime-owner recovery, order old
retirement before candidate activation, and pin every draining release. Rampway
must treat healthy candidate activation as deploy success and release its lock
without waiting for retired generations. Do not claim end-to-end production
compliance until those supervisor and deployment prerequisites are installed.

Within the Velocious worker/main protocol, jobs-main owns worker connections,
lease fencing, report acceptance/acknowledgement, and durable store transitions;
the worker/reporting side owns durable terminal-report retry, report-promise
draining, per-job timeout execution, and child-runner reaping. The supervisor
supplies generation process/endpoint ownership and durable recovery. The
deployment tool supplies activation, deploy locking, and release cleanup pins.

### Enabling generation mode

Generation mode is explicit and fail-loud. The id must match
`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`; config, environment, API, and CLI values
must either be absent or identical. Empty, malformed, or conflicting values
abort before the generation main listens. When the id is unset, the established
legacy endpoint, worker ids, handshake, immediate disconnect recovery, and
third-party adapter behavior remain unchanged.

An ID without an explicit initial state defaults to `candidate`. That derived
default is not an explicit source: an API or CLI recovery start may supply
`active` or `retired`. Actual config, environment, API, and CLI state values are
still fail-loud and must agree when more than one is supplied.

```js
backgroundJobs: {
  generationId: "release-20260828.1",
  initialGenerationState: "candidate",
  host: "127.0.0.1",
  port: 17431,
  lifecycleSocketPath: "/srv/my-app/releases/20260828.1/run/background-jobs.sock"
}
```

The equivalent process environment is:

```sh
VELOCIOUS_BACKGROUND_JOBS_GENERATION_ID=release-20260828.1
VELOCIOUS_BACKGROUND_JOBS_INITIAL_GENERATION_STATE=candidate
VELOCIOUS_BACKGROUND_JOBS_HOST=127.0.0.1
VELOCIOUS_BACKGROUND_JOBS_PORT=17431
VELOCIOUS_BACKGROUND_JOBS_LIFECYCLE_SOCKET_PATH=/srv/my-app/releases/20260828.1/run/background-jobs.sock
```

The main command also accepts `--generation`, `--initial-generation-state`, and
`--lifecycle-socket`; the worker accepts `--generation`. Spawned, forked, and
pooled runners inherit the exact endpoint and generation from their worker.
Generation-aware workers, clients, and status reporters require the hello
acknowledgement before readiness or mutation and destroy an unacknowledged
connection after 4000ms by default. The initiating APIs accept
`generationHandshakeTimeoutMs` for a shorter operational deadline or focused
testing; each connection sends exactly one hello.

`candidate` is quiescent: it performs no schedule ownership, concurrency
reconciliation, dispatch, reclaim, or orphan sweep. Activation transitions it
to `active`. If an operational recovery retires the candidate while activation
is still reconciling durable queue state, that retirement fence wins and the
in-flight activation cannot restore active ownership or return a successful
lifecycle acknowledgement. Retirement installs its admission fence
synchronously, stops new schedules/dispatch/admission/handoffs, then transitions
through `retiring` to `retired` while preserving accepted workers, reports,
acknowledgements, timeouts, child reaping, and durable transitions. A restarted
`retired` main recovers only exact durable handoffs for its own generation and
never dispatches global queue work. It reaches `stopped` only after its exact
workers, handoffs, reports, worker connections, and lifecycle acknowledgements
drain.

Worker ownership is stored as `<generationId>:<workerUuid>` (maximum 165
characters). The built-in SQL schema already gives `worker_id` 255 characters
on SQLite, MariaDB/MySQL, PostgreSQL, and MSSQL, so enabling this feature needs
no migration. Generation mode requires an adapter whose
`supportsReleaseScopedGenerations()` returns `true`; the built-in SQL adapter
does. Unsupported third-party adapters are rejected before listening, while
legacy mode remains compatible with them.

The built-in SQL adapter bounds activation-time queue reconciliation to
queue-derived concurrency keys plus counters that are active or stale. It does
not execute a job-table count query for every historical concurrency key. Its
internal schema migration also repairs missing single-column job indexes from
older `queue`, `schedule_key`, and `concurrency_key` add-column upgrades before
activation uses them. SQLite emits conflict-safe index creation for that repair,
so independent generation processes remain safe even if both observed a missing
index before database serialization.

### Lifecycle control socket

The release supervisor controls a candidate through the package-owned local
Unix socket with exactly one acknowledged request:

```sh
npx velocious background-jobs:activate \
  --generation release-20260828.1 \
  --socket /srv/my-app/releases/20260828.1/run/background-jobs.sock \
  --timeout-ms 10000

npx velocious background-jobs:retire \
  --generation release-20260828.1 \
  --socket /srv/my-app/releases/20260828.1/run/background-jobs.sock \
  --timeout-ms 10000
```

There is no polling, retry, PID guessing, marker file, or remote control
endpoint. The socket must be an absolute portable-length path inside the release
directory, under a real directory owned by the process user. Velocious creates
it mode `0600`, refuses symlink/non-socket/foreign-owner/active collisions,
removes only a same-owner stale socket whose inode did not change during the
check, and removes its own path on shutdown only if the inode is still the one
it created. Requests and acknowledgements carry the exact generation and a UUID;
server errors preserve their name/message/stack and are also emitted on
`framework-error` and `all-error` for supervisors whose hooks ignore stdio.
The client issues one request with no retry and defaults to a hard 10000ms
deadline (configurable from 1 through 60000ms so supervised lifecycle transitions
can use a full-minute deadline); timeout destroys the socket and exits the CLI
nonzero.

## Worker shutdown and process-job draining

When a `background-jobs-worker` receives `SIGTERM`/`SIGINT` it stops accepting new
work, drains in-flight jobs, and exits. Out-of-process jobs include
`executionMode: "pooled"` jobs, which run serially in reusable attached children,
`executionMode: "forked"` jobs, which run in an attached `child_process.fork()`
child, and `executionMode: "spawned"` jobs, which use the legacy spawned
`background-jobs-runner` CLI process. On a graceful stop the worker waits for
those runners and then terminates any that outlast the drain window (`SIGTERM`,
then `SIGKILL` after a short grace) so they are not orphaned across a deploy —
an orphaned runner keeps running against deleted release code and holds its
database connections open.

After a forked runner receives the main process's durable status
acknowledgement, it invokes application initializer teardown and bounded
Beacon/database cleanup before exit. Cleanup failure remains visible but does
not reinterpret the already acknowledged durable job outcome. SIGTERM, SIGINT,
and parent disconnect use that same cleanup path. The compatible direct spawned
one-shot command retains its established exit behavior and
`background-jobs-runner` process type. If acknowledgement is missing or rejected
through `job-update-error`, the one-shot runner exits as failed and does not
reinterpret the acknowledgement-delivery failure as a failed job-performance report.

A pooled child initializes once as `background-jobs-pooled-runner`, reuses the
same application process context across admitted jobs, and never tears
initializers down per job. Framework connection rotation remains framework-only.
Final signal/disconnect teardown runs once; a replacement child receives a new
opaque lifecycle `instanceId`. Forked children use
`background-jobs-forked-runner`. See
[application process lifecycle](application-process-lifecycle.md).

`BackgroundJobsMain` and `BackgroundJobsWorker` normally own their configuration
lifetimes and close its database pools on `stop()`. An embedded process or test
harness that passes a configuration whose pools are owned by its caller must
construct either service with `closeDatabaseConnectionsOnStop: false`; shutdown
still disconnects Beacon and closes the service sockets without invalidating
the caller's active database connections or application initializer lifecycle.
The embedding owner must later call `configuration.shutdown()` and its framework
cleanup. Embedded lifecycle coordinators can
also pass an async `onStopped` hook; it runs after service-owned shutdown work
finishes, without replacing or narrowing either service's `stop()` contract.
Concurrent and repeated `stop()` calls share one lifecycle and invoke the hook
once. If shutdown and the hook both fail, `stop()` rejects with an
`AggregateError` whose errors contain the shutdown failure first.

When the main or worker owns cleanup, initializer teardown runs only after its
accepted work, durable reports, child runners, and generation-specific drain
settle, immediately before framework cleanup. Retirement and activation do not
tear down or transfer the old generation's application lifecycle.

The drain window is controlled by `VELOCIOUS_BACKGROUND_JOBS_WORKER_SHUTDOWN_TIMEOUT_MS`:

- unset, `"indefinite"`, or `"0"` (default): wait for in-flight jobs to finish
  and never interrupt a running job. Use this when jobs may run for a long time
  (e.g. builds) and a deploy must not cut them off.
- a positive integer (milliseconds): finish in-flight jobs for up to that long,
  then reap any pooled, forked, or spawned runners still in flight.

When a process supervisor force-kills the worker after its own graceful-stop
window, set this timeout shorter than that window so the worker reaps its process
runners itself before the supervisor's `SIGKILL` (which would orphan them). With
the indefinite default, give the supervisor a graceful-stop window at least as
long as your longest job instead.

This worker-local setting does not bound deployment completion. Normal deploy
retirement is asynchronous, and an hours-long legitimate job makes an hours-long
generation drain valid. Use per-job timeout for a genuinely hung job; do not set
a short normal shutdown timeout merely to make deploy return.

## Job Timeout (hung-runner backstop)

The shutdown drain above bounds how long *shutdown* waits, but it does not bound
a single job's runtime. A genuinely-hung `"forked"` runner — stuck in a native
call, a wedged socket read, a deadlock — never finishes, so it keeps its slot,
its whole-app boot, and its database connections. That is especially costly
while a retired release's worker drains after a deploy: with an indefinite drain
(`VELOCIOUS_BACKGROUND_JOBS_WORKER_SHUTDOWN_TIMEOUT_MS`), one hung job pins that
worker's resources until the process is killed by hand.

`backgroundJobs.jobTimeoutMs` (config) or `VELOCIOUS_BACKGROUND_JOBS_JOB_TIMEOUT_MS`
(env, milliseconds) arms a wall-clock backstop for forked and pooled jobs. A job
still running after the timeout is terminated — `SIGTERM`, then `SIGKILL` after
the same reaping grace as shutdown — and reported `failed` with a timeout
message. For a **forked** job that kills its dedicated runner. For a **pooled**
job it kills the shared child running the hung job, so that child's other
in-flight jobs are also reported `failed` and requeued — a hung JS job can't be
cancelled otherwise — and a replacement child is spawned. Either way the slot is
freed on exit, so the worker (including a draining one) can always reach zero
in-flight jobs and exit.

Set `options.timeoutMs` on an individual forked or pooled job when its safe
runtime ceiling differs from the worker default. A positive per-job value takes
precedence over `backgroundJobs.jobTimeoutMs`; a non-positive finite value
disables the backstop for that job. Positive values
must be integers no greater than `2_147_483_647` (Node's maximum supported timer);
wrong types, non-finite values, fractions, and larger values are rejected before
the job is persisted. Omitting `timeoutMs` keeps the worker-level setting as the
fallback.

```js
await BuildJob.performLaterWithOptions({
  args: [projectId],
  options: {executionMode: "pooled", timeoutMs: 10 * 60 * 1000}
})
```

```js
backgroundJobs: {
  // Kill and fail any forked runner still going after 90 minutes.
  jobTimeoutMs: 90 * 60 * 1000
}
```

The worker-level setting is a coarse default, so set it **well above** the
longest legitimate forked or pooled job unless individual jobs supply tighter
timeouts. Omit it, or set `null`/`<= 0`, to disable the default. `"inline"` jobs
are not covered: they share the worker's process and cannot be killed without
killing the worker.
