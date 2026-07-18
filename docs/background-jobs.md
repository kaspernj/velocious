# Background Jobs

Velocious background jobs are documented in the main README. This page covers behavior that applications usually need when operating background jobs in production.

## Durable concurrency limits

Pass `concurrencyKey` and `maxConcurrency` together in `jobOptions` (or in `performLaterWithOptions`). The key is an opaque, non-empty string shared by jobs that use the same limit, and the cap is a positive integer. Omitting both preserves unlimited behavior. Once a key is registered, every enqueue for that key must use the same cap; a conflicting cap is rejected.

Limits are enforced by durable database reservations shared by every main/worker process. Saturated keys do not prevent unrelated queued jobs from being dispatched. Reservations are released when work completes, fails terminally, is requeued for retry, is cancelled, or is recovered as orphaned; startup reconciliation repairs reservation counts after an unclean scheduler stop.

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
- Caps are config-driven and tunable. Adding, removing, or changing `queues[name].maxConcurrent` is reconciled against the existing backlog when the main process starts: persisted jobs adopt or release the queue key to match the current config, so a changed cap takes effect without waiting for the queue to drain.
- Scheduled jobs (`scheduledBackgroundJobs`) honor a job class's `static queue` as well.

### Priorities

`queues[name].priority` (default `0`) makes the main process dispatch higher-priority queues before lower-priority ones, regardless of when each job was enqueued. This keeps a small, time-critical queue (a build planner, webhook processing) from being starved by a flood of low-priority work that shares the same worker pool — the exact failure that an under-sized single `default` queue produces: side-effect noise crowds out the jobs that actually move the pipeline forward.

Unlike Sidekiq's strict queue ordering, priority **composes with the per-queue caps**: a higher-priority queue that is already at its `maxConcurrent` is skipped, and dispatch falls through to the next eligible lower-priority job. So a busy high-priority queue can't block everything behind it — it only wins while it has spare capacity. Priorities may be any number (negative sinks a queue below the default), and jobs within the same priority keep FIFO (`scheduled_at`, then `created_at`) order. Priority ordering applies only to the dispatch decision; it does not reorder future-scheduled jobs, which stay strictly time-ordered.

The cap-fallthrough guarantee is a property of the **queue-derived** cap. A job that supplies its own explicit `concurrencyKey`/`maxConcurrency` bypasses the queue cap entirely — an explicit key always wins (see above) — so it is bounded only by that explicit key, not by `queues[name].maxConcurrent`. Such a job is therefore never held back by the queue's cap; priority just orders it normally against the rest. If you want a job to be bounded by both a queue cap and a finer-grained key, model the finer-grained limit as its own queue rather than an explicit `concurrencyKey`.

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

Deletion is batched by id (`SELECT` a page, then `DELETE ... WHERE id IN (...)`) so a large backlog is removed incrementally rather than in one long transaction. Retention only ever deletes terminal rows; `queued` and in-flight jobs are never pruned.

## Worker Disconnect Recovery

Each durable worker handoff has a unique lease id. If a worker socket disconnects unexpectedly, `background-jobs-main` immediately returns only the jobs handed to that exact socket to the queue and makes them available to another connected worker. Two connections that advertise the same worker id remain isolated from each other.

Disconnect recovery provides at-least-once delivery: a disconnected worker may already have started external side effects before the replacement attempt begins. Completion and failure reports carry the lease id and update the database only while that exact handoff is still active, so a late report from the disconnected attempt cannot complete or fail a newer attempt.

Graceful draining is unchanged. A worker that announces `draining` keeps its socket open while its in-flight jobs finish, and those jobs are not reclaimed unless that socket is subsequently lost before their reports are accepted.

The fenced protocol uses an explicit worker handshake capability. A main process that creates lease ids dispatches new jobs only to workers advertising handoff-id reporting; older workers remain connected so they can report legacy handoffs that have no lease id. During a rolling upgrade, upgrade workers before the main process to avoid pausing new dispatch while only legacy workers are connected.

Restarting the **main** (every deploy) is handled by adopting handoffs on reconnect. A fresh main holds no in-memory leases, so from its perspective every pre-existing `handed_off` row is unowned — and disconnect recovery only fires on a worker socket `close`, which the old main's sockets do on it, not the new one. When a worker reconnects with its stable id (its `hello`), the new main queries the store for that worker's still-active handoffs and adopts them into the reconnected socket's lease map. If that worker later disconnects, those adopted leases are released like any other; while it keeps running, its in-flight jobs are untouched. The main deliberately does **not** time-reclaim handoffs whose worker hasn't reconnected: a gracefully-draining worker from the old release keeps executing its jobs (and reports them over the status-reporter's own connection) without ever reconnecting its control socket, so requeuing on a timer would double-run it. Handoffs of a worker that never returns (a crash) are left to the age-based orphan sweep, which is long enough to be sure the worker is truly gone.

## Worker Liveness

Disconnect recovery above depends on the worker's control socket firing a `close` event. A worker that wedges while alive — or a half-open TCP connection — never fires `close`, so its leases (and, if it is the only worker, the whole queue) would stay stuck until someone intervened. Two mechanisms make this self-healing:

- **Heartbeats.** A worker advertises `supportsHeartbeat` in its hello and then sends a periodic `heartbeat` (default every 15s); the sockets also enable TCP keepalive. The main records the last time it saw any message from each worker and, on a periodic sweep, drops a heartbeat-capable worker that has been silent longer than `workerStaleTimeoutMs` (default 60s) — releasing its leases so its jobs run elsewhere and it stops receiving new work. A worker that does **not** advertise heartbeat support (for example an older release mid rolling deploy) is exempt from stale eviction and is only reclaimed through the `close`-based path, so its in-flight leases are never released while it is still running them.
- **Decoupled, durable reporting.** Freeing a worker's job slot never waits on reporting the result to the main. When a job (inline or forked) finishes, its slot is released immediately and the completion/failure report is sent in the background and retried durably until it lands. A transient main/DB outage therefore can neither leak worker slots (which previously drove the worker to stop accepting jobs) nor lose a terminal report and re-run already-completed work. A graceful `stop()` drains in-flight reports before closing the socket.
- **Readiness re-announcement.** The main removes a worker from its ready set on each dispatch and only re-adds it when the worker sends a fresh `ready`. A worker therefore re-announces free capacity on *every* completion that leaves it below its cap, not only on the single at-cap→below-cap edge — so a missed re-signal can no longer strand a worker out of the ready set and silently freeze dispatch (a failure mode that surfaced under bursty high-concurrency load). Because each re-announce corresponds to a genuinely freed slot, it never advertises capacity that a still-in-flight handoff will consume (which a timer-based re-announce would).

Heartbeat interval, stale timeout, and sweep interval are overridable via the worker/main constructors for tests and tuning.

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

The mirrored `all-error` payload includes the same `error` and `context` plus `errorType: "background-job-failed"`.

### Orphaned jobs

`background-jobs-main` also emits a `background-job-orphaned` error event (mirrored to `all-error` as `errorType: "background-job-orphaned"`) for each job its time-based orphan sweep reclaims — a job whose worker died mid-run and stopped reporting, so it was stuck `handed_off` past the orphan timeout. Unlike `background-job-failed`, which fires on a worker's failure report, this fires from the main process's sweep, so an application can react to the specific job a dead worker left behind — enqueue a targeted recovery for the work it was doing — instead of only polling for the aftermath.

```js
configuration.getErrorEvents().on("background-job-orphaned", ({error, context}) => {
  if (context.jobName !== "RunBuildJob") return

  // context.jobArgs are the orphaned job's serialized arguments.
  enqueueTargetedRecovery(context.jobArgs[0])
})
```

The `background-job-orphaned` payload mirrors `background-job-failed`: `error` (the orphan reason as an `Error`) and `context` with `attempts`, `jobArgs`, `jobId`, `jobName`, `maxRetries`, `status`, `terminal`, `willRetry`, and `stage: "background-job-orphaned"`. `willRetry` is `true` when the reclaim returned the job to the queue for another attempt (retries remaining) and `false` when it was exhausted into a terminal `orphaned` state.

## Worker Shutdown And Process-Job Draining

When a `background-jobs-worker` receives `SIGTERM`/`SIGINT` it stops accepting new
work, drains in-flight jobs, and exits. Out-of-process jobs include
`executionMode: "forked"` jobs, which run in an attached `child_process.fork()`
child, and `executionMode: "spawned"` jobs, which use the legacy spawned
`background-jobs-runner` CLI process. On a graceful stop the worker waits for
those runners and then terminates any that outlast the drain window (`SIGTERM`,
then `SIGKILL` after a short grace) so they are not orphaned across a deploy —
an orphaned runner keeps running against deleted release code and holds its
database connections open.

After a forked or spawned one-shot runner receives the main process's durable
status acknowledgement, it exits without waiting for graceful Beacon/database
teardown; the operating system closes those process-owned resources. This keeps
a completed runner from lingering when a graceful socket close stalls. Inline
and long-lived worker shutdown still performs graceful framework cleanup. If
the acknowledgement is missing or rejected through `job-update-error`, the
one-shot runner exits as failed and does not reinterpret the transport failure
as a failed job-performance report.

The drain window is controlled by `VELOCIOUS_BACKGROUND_JOBS_WORKER_SHUTDOWN_TIMEOUT_MS`:

- unset, `"indefinite"`, or `"0"` (default): wait for in-flight jobs to finish
  and never interrupt a running job. Use this when jobs may run for a long time
  (e.g. builds) and a deploy must not cut them off.
- a positive integer (milliseconds): finish in-flight jobs for up to that long,
  then reap any forked or spawned runners still in flight.

When a process supervisor force-kills the worker after its own graceful-stop
window, set this timeout shorter than that window so the worker reaps its process
runners itself before the supervisor's `SIGKILL` (which would orphan them). With
the indefinite default, give the supervisor a graceful-stop window at least as
long as your longest job instead.

## Forked Job Timeout (hung-runner backstop)

The shutdown drain above bounds how long *shutdown* waits, but it does not bound
a single job's runtime. A genuinely-hung `"forked"` runner — stuck in a native
call, a wedged socket read, a deadlock — never finishes, so it keeps its slot,
its whole-app boot, and its database connections. That is especially costly
while a retired release's worker drains after a deploy: with an indefinite drain
(`VELOCIOUS_BACKGROUND_JOBS_WORKER_SHUTDOWN_TIMEOUT_MS`), one hung job pins that
worker's resources until the process is killed by hand.

`backgroundJobs.jobTimeoutMs` (config) or `VELOCIOUS_BACKGROUND_JOBS_JOB_TIMEOUT_MS`
(env, milliseconds) arms a per-runner wall-clock backstop. A forked job still
running after the timeout is terminated — `SIGTERM`, then `SIGKILL` after the
same reaping grace as shutdown — and reported `failed` with a timeout message.
The runner's slot is freed on exit, so the worker (including a draining one) can
always reach zero in-flight jobs and exit.

```js
backgroundJobs: {
  // Kill and fail any forked runner still going after 90 minutes.
  jobTimeoutMs: 90 * 60 * 1000
}
```

This is a coarse safety net, not per-job tuning. It applies to every forked
runner on the worker, so set it **well above** the longest legitimate forked job
(build runners, large imports) — pick a ceiling that only a stuck runner would
ever cross. Omit it, or set `null`/`<= 0`, to disable (the default), which keeps
the prior unbounded behavior. `"inline"` jobs are not covered: they share the
worker's process and cannot be killed without killing the worker.
