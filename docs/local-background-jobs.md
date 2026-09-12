# Local background jobs

Browser and Expo configurations have a built-in durable background-jobs backend. It stores work in an existing configured SQLite database and runs eligible jobs in the current JavaScript process. No TCP socket, child process, filesystem discovery, or Node configuration resolver is used.

## Configuration

Register every portable job class statically so Metro and browser bundlers can include it and persisted names remain resolvable after restart:

```js
import Configuration from "velocious/build/src/configuration.js"
import VelociousJob from "velocious/build/src/background-jobs/platform-job.js"

class UploadPendingChangesJob extends VelociousJob {
  static databaseIdentifiers = []

  async perform(projectId) {
    await uploadPendingChanges(projectId)
  }
}

export default new Configuration({
  backgroundJobs: {
    databaseIdentifier: "default",
    jobClasses: [UploadPendingChangesJob],
    maxConcurrentInlineJobs: 4,
    queues: {
      uploads: {maxConcurrent: 2, priority: 10}
    }
  },
  // Existing Browser/Expo SQLite database configuration.
  database: {/* ... */}
})
```

`jobClasses` must be an array of `VelociousJob` subclasses with unique, non-empty `jobName()` values. Enqueueing an unregistered class fails before a row is written. Renaming or removing a class with persisted work is an application upgrade concern: keep an alias or drain the old name first.

The default database identifier is `default`. The selected database must already be a local SQLite database. The queue belongs to that configuration/catalog database; it does not follow an ambient tenant connection.

Use the portable `platform-job.js` entry in Browser/Expo code. `performLater()` resolves after durable enqueue, not after `perform()` completes. Omitted `executionMode` and explicit `executionMode: "inline"` run in process. Node-only `pooled`, `forked`, and `spawned` modes are rejected by the local adapter.

## Durable behavior

The local adapter creates versioned, namespaced `velocious_local_background_jobs`, `velocious_local_background_job_concurrency`, and `velocious_local_background_job_schedule_keys` tables on first use. Schema version `2` adds nullable `schedule_key` history to job rows, a single owner row per schedule key, and owner/history indexes. Version `3` additively adds nullable monotonic `schedule_order` history and its lookup index. An existing version-1 or version-2 database upgrades without resetting queued or handed-off rows; versions are recorded under the `local_background_jobs` scope in `velocious_internal_migrations`. Readiness is safe when several callers arrive together, when creation participates in an application transaction that rolls back, and when an existing database is reopened. Missing current-version indexes are repaired; an incompatible table is reported through `framework-error`/`all-error` and is not silently rebuilt or discarded.

The local store provides the same applicable queue contract as Node:

- `queue`, queue priorities, queue `maxConcurrent`, and explicit `concurrencyKey`/`maxConcurrency`;
- `deduplicateWhileQueued` by job name, serialized arguments, and queue;
- `scheduledAtMs` with an exact timer rather than fixed polling;
- stable `replaceScheduled`, `cancelScheduled`, `getScheduledJob`, and
  `wakeScheduled` ownership with retained normalized history;
- `maxRetries` with 10-second, 1-minute, 10-minute, 1-hour, then increasing hourly backoff;
- `rescheduleIn(delayMs)` on the same row without consuming a retry;
- fenced handoff acknowledgements so a stale completion cannot update reclaimed work.

The local store accepts an optional caller-selected `handoffId` and persists it
exactly in the durable claim. Direct callers that omit it retain the legacy
generated-id behavior; callers coordinating an ambiguous claim should retain
and fence the supplied id.

Queue-cap reconciliation, deduplication, insertion, stable-owner transitions, capacity reservation, claims, acknowledgements, and capacity release are transactional. SQLite write serialization is the durable ordering boundary for local schedule keys; no process-memory lock owns correctness. A local enqueue, replacement, cancellation, or successful/due wake performed inside an application transaction registers its dispatcher wake with `afterCommit`: committed work becomes visible before execution, while rollback removes the mutation and discards the wake. Dispatcher drain work starts outside the caller's database connection and revocable test-attempt contexts, so it checks out and owns its transactions independently instead of retaining a connection after the caller commits, checks it in, or ends an attempt.

Stable lookup returns the current queued/handed-off owner and, when requested,
the latest terminal history as normalized public job values. New owners receive
a monotonic `scheduleOrder` after SQLite write serialization is acquired. Wake only moves a
future queued owner's eligibility to now and preserves its id, attempts, failure
metadata, and lineage. It never enqueues a replacement. Queued cancellation is
strict; a handed-off owner is detached without claiming its JavaScript stopped.
The local adapter has no automatic terminal-history retention path, so its order
remains derived from retained local history; the independent pruning-resistant
high-water table belongs only to the Node SQL store's retention contract.
See [Scheduling One-Off Background Jobs](scheduled-background-job-enqueue.md#replacing-or-cancelling-a-logical-schedule)
for result shapes and application revision fencing.

Job failures emit `background-job-failed` and its `all-error` mirror for both retrying and terminal attempts. Unexpected readiness, dispatch, storage, timer, or acknowledgement failures emit `framework-error` and `all-error`; they are not silently logged and dropped.

## Lifecycle and delivery

One adapter is owned by one `Configuration` lifecycle. Repeated dispatcher and stable-schedule wakes coalesce into one admission loop while stable API results still report the exact durable row outcome. The dispatcher claims only enough work to fill `maxConcurrentInlineJobs`, releases the claim connection before calling application code, and lets unrelated concurrency keys progress when another key is saturated.

`Configuration.closeBackgroundJobsAdapter()` and database shutdown stop new claims, clear scheduled/error-recovery timers, and wait for every in-flight performance and durable acknowledgement. A later adapter generation safely reopens the same schema, schedule ownership, and history. On startup, any `handed_off` row left by an interrupted process enters the ordinary failure/retry transition before new work is admitted. Delivery is therefore at least once: termination after application side effects but before acknowledgement can repeat a job.

Web durability follows the existing SQL.js persistence choice. OPFS, IndexedDB, or the legacy fallback persists the complete SQLite image, including the namespaced local queue, across close/reopen. An intentionally in-memory database provides no cross-reload durability. Expo uses the existing `expo-sqlite` driver.

## Boundaries

The local adapter supports one active configuration-owned adapter per app/database. It does not coordinate simultaneous dispatchers in multiple tabs.

The following remain separate work:

- no Expo OS background-task/headless wake;
- no Web Worker, Service Worker, Shared Worker, or multi-tab leader election;
- no recurring/cron scheduler;
- no Cloudflare backend;
- no custom IndexedDB ORM or new SQLite WASM dependency;
- no local `idempotencyKey`, server dashboard schema, retention scheduler, or mail-delivery ownership;
- no local adapter implementation of Node SQL/TCP/main/worker coordination.

See [Background Jobs](background-jobs.md) for the shared job API and Node operational model, [SQLite web persistence](sqlite-web-persistence.md) for browser durability, and [Expo and Metro compatibility](expo-metro-compatibility.md) for native/web bundle resolution.
