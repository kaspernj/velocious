# Background Jobs

Velocious background jobs are documented in the main README. This page covers behavior that applications usually need when operating background jobs in production.

## Durable concurrency limits

Pass `concurrencyKey` and `maxConcurrency` together in `jobOptions` (or in `performLaterWithOptions`). The key is an opaque, non-empty string shared by jobs that use the same limit, and the cap is a positive integer. Omitting both preserves unlimited behavior. Once a key is registered, every enqueue for that key must use the same cap; a conflicting cap is rejected.

Limits are enforced by durable database reservations shared by every main/worker process. Saturated keys do not prevent unrelated queued jobs from being dispatched. Reservations are released when work completes, fails terminally, is requeued for retry, is cancelled, or is recovered as orphaned; startup reconciliation repairs reservation counts after an unclean scheduler stop.

## Worker Disconnect Recovery

Each durable worker handoff has a unique lease id. If a worker socket disconnects unexpectedly, `background-jobs-main` immediately returns only the jobs handed to that exact socket to the queue and makes them available to another connected worker. Two connections that advertise the same worker id remain isolated from each other.

Disconnect recovery provides at-least-once delivery: a disconnected worker may already have started external side effects before the replacement attempt begins. Completion and failure reports carry the lease id and update the database only while that exact handoff is still active, so a late report from the disconnected attempt cannot complete or fail a newer attempt.

Graceful draining is unchanged. A worker that announces `draining` keeps its socket open while its in-flight jobs finish, and those jobs are not reclaimed unless that socket is subsequently lost before their reports are accepted.

The fenced protocol uses an explicit worker handshake capability. A main process that creates lease ids dispatches new jobs only to workers advertising handoff-id reporting; older workers remain connected so they can report legacy handoffs that have no lease id. During a rolling upgrade, upgrade workers before the main process to avoid pausing new dispatch while only legacy workers are connected.

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
