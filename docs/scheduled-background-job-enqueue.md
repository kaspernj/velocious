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

## Replacing or cancelling a logical schedule

Use a stable schedule key when application state may move or remove the desired one-off job. Keys are opaque, non-empty strings of at most 255 characters and are global within the configured background-jobs database:

```js
const scheduleKey = `event:${eventId}:reminder:24h`

const replacement = await EventReminderJob.replaceScheduled({
  scheduleKey,
  args: [eventId, reminderRevision],
  options: {scheduledAtMs: reminderAtMs}
})

const cancellation = await EventReminderJob.cancelScheduled(scheduleKey)
```

`replaceScheduled` always creates a new job id and returns `{jobId, previousJobId, previousStatus}`. If the previous owner is still `queued`, replacement atomically marks it `cancelled`, inserts the new job, and moves key ownership. If it is already `handed_off`, Velocious leaves that lease running and returns `previousStatus: "handed_off"`; the new job still becomes the current owner.

`cancelScheduled` returns `{jobId, outcome}`:

- `"cancelled"` means the queued transition won and the job cannot subsequently be handed off.
- `"handed_off"` means ownership was removed, but execution may already be running and was not stopped.
- `"not_found"` means the key has no current owner. Repeating a successful cancellation therefore returns `"not_found"`.

Replacement and cancellation wake the event-driven dispatcher and rebuild its future-job timer, including when a replacement moves earlier or cancellation removes the earliest job. Their acknowledgements wait for the corresponding drain lifecycle; a request that overlaps a drain already in progress coalesces into that lifecycle and waits for its re-drain and timer re-arm instead of acknowledging early. Existing drain failures retain the configured retry behavior. The current owner survives process restarts in framework-managed database state.

Job history keeps `scheduleKey` after replacement, cancellation, completion, failure, or orphaning, while terminal jobs release current ownership. The dashboard API exposes this historical field.

### Fence irreversible effects in the application

Stable-key cancellation is deliberately best-effort once a worker has received a job. Applications must store a generation or revision with the state that controls the schedule, pass it in job arguments, and compare the current value immediately before an irreversible effect:

```js
export default class EventReminderJob extends VelociousJob {
  async perform(eventId, expectedRevision) {
    const event = await Event.find(eventId)

    if (!event || event.reminderRevision() !== expectedRevision || event.cancelled()) return

    await sendReminder(event)
  }
}
```

Commit the new revision before replacing or cancelling the schedule. This protects against a superseded handed-off job completing or retrying after ownership moved. Existing handoff leases still fence worker reports; stable keys do not terminate running JavaScript.

Deploy or restart the upgraded `background-jobs-main` before application processes begin sending these new protocol messages. Legacy `performLater`, `performLaterWithOptions`, and `scheduledAtMs` calls and return values are unchanged.
