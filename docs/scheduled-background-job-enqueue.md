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

const scheduled = await EventReminderJob.getScheduledJob(scheduleKey, {
  includeLatestTerminal: true
})
const wake = await EventReminderJob.wakeScheduled(scheduleKey)
const cancellation = await EventReminderJob.cancelScheduled(scheduleKey)
```

`replaceScheduled` always creates a new job id and returns `{jobId, previousJobId, previousStatus}`. If the previous owner is still `queued`, replacement atomically marks it `cancelled`, inserts the new job, and moves key ownership. If it is already `handed_off`, Velocious leaves that lease running and returns `previousStatus: "handed_off"`; the new job still becomes the current owner.

`cancelScheduled` returns `{jobId, outcome}`:

- `"cancelled"` means the queued transition won and the job cannot subsequently be handed off.
- `"handed_off"` means ownership was removed, but execution may already be running and was not stopped.
- `"not_found"` means the key has no current owner. Repeating a successful cancellation therefore returns `"not_found"`.

Replacement and cancellation wake the event-driven dispatcher and rebuild its future-job timer, including when a replacement moves earlier or cancellation removes the earliest job. On Node/TCP, their acknowledgements wait for the corresponding main-process drain lifecycle; a request that overlaps a drain already in progress coalesces into that lifecycle and waits for its re-drain and timer re-arm instead of acknowledging early. Existing drain failures retain the configured retry behavior. The local adapter commits an adapter-owned transaction before its dispatcher wake runs; inside an ambient application transaction, both remain deferred to the outer commit. Execution remains asynchronous. The current owner survives close/reopen in framework-managed database state.

`getScheduledJob(scheduleKey, {includeLatestTerminal: true})` returns
`{currentJob, latestTerminalJob}`. `currentJob` is the normalized public `queued`
or `handed_off` owner, or `null`. The optional terminal value is the newest
`cancelled`, `completed`, `failed`, or `orphaned` job for the key. Both values use
the complete public camel-case job shape, not adapter store rows, and TCP clients
reject incomplete rows or rows whose status does not belong in its response slot. Without
`includeLatestTerminal`, `latestTerminalJob` is `null`.

Each replacement receives a monotonic `scheduleOrder` while its schedule-key
ownership transaction is locked. Terminal lookup sorts ordered rows by that
causal sequence, not preparation time or random job id. On Node SQL databases,
the per-key high-water mark is stored independently of owner and job rows, so it
survives owner release and terminal-history retention pruning. The additive
upgrade initializes each high-water mark from the greatest retained ordered row,
including keys without a current owner. Rows created before the order column was
available retain `scheduleOrder: null` and do not initialize a mark: ordered rows
rank ahead of legacy rows, while legacy-only history falls back deterministically
to `createdAtMs` descending and then job id descending. A legacy-only key starts
at order `1` when it next receives a new owner.

`wakeScheduled(scheduleKey)` expedites the existing owner and returns
`{jobId, outcome}`:

- `"woken"` means a future queued owner's `scheduledAtMs` moved to the current time.
- `"already_due"` means the queued owner was already eligible; dispatch is still poked.
- `"handed_off"` means execution has already crossed the handoff boundary and no row changed.
- `"not_found"` means the key has no active owner.

Wake never falls back to enqueue. It preserves the job id, arguments, attempt
count, last error, retry lineage, concurrency metadata, and schedule ownership,
and wakes dispatch only after the database transaction commits. Repeated wake
calls therefore converge on the same row instead of creating duplicates.

Job history keeps `scheduleKey` after replacement, cancellation, completion, failure, or orphaning, while terminal jobs conditionally release current ownership. A detached predecessor cannot remove a newer owner when its eventual acknowledgement arrives. The dashboard API exposes this historical field.

The stable replacement, cancellation, readback, and wake APIs use Node's SQL/TCP
producer path and the Browser/Expo local SQLite adapter. Inline mode has no
durable owner and rejects all four operations. Local dispatch still requires the
application runtime to be active; wake does not provide Android/iOS headless
execution. See [Local background jobs](local-background-jobs.md).

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

Deploy or restart the upgraded `background-jobs-main` before Node application processes begin sending these protocol messages. Release-scoped retired mains reject new stable-schedule requests and continue only their existing drain responsibilities. Legacy `performLater`, `performLaterWithOptions`, and `scheduledAtMs` calls and return values are unchanged.
