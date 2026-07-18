# Scheduling One-Off Background Jobs

Pass `scheduledAtMs` to `performLaterWithOptions` when a job should become eligible at one exact epoch timestamp in milliseconds:

```js
await MyJob.performLaterWithOptions({
  args: ["account-123"],
  options: {scheduledAtMs: Date.now() + 2 * 60 * 60 * 1000}
})
```

The job is persisted immediately with status `queued`, but workers cannot receive it before `scheduledAtMs`. The event-driven dispatcher arms a timer for the earliest future job and re-evaluates the queue at that timestamp. A main-process restart does not lose the schedule because the timestamp lives in the background-jobs table.

`scheduledAtMs` must be a non-negative JavaScript safe integer. Invalid values reject the enqueue promise with the validation message. A timestamp in the past, including `0`, is valid and makes the job eligible for immediate dispatch. Omitting the option preserves immediate enqueue behavior.

This option schedules one job once. For recurring jobs, use the [`scheduledBackgroundJobs` configuration](../README.md#scheduled-jobs). For queue limits, retries, worker recovery, and operational behavior, see [Background Jobs](background-jobs.md).
