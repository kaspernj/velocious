# Background Jobs

Velocious background jobs are documented in the main README. This page covers behavior that applications usually need when operating background jobs in production.

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
