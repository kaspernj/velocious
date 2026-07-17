# Changelog

- Apply a job class's `static queue` when it is enqueued through `scheduledBackgroundJobs`, so a scheduled job lands on its queue (and honors the configured cap) instead of always running on `"default"`.
- Reconcile queue-derived concurrency against the current config once per process on startup: sync each configured queue's stored cap and adopt or release persisted non-terminal jobs so an added, removed, or changed `queues[name].maxConcurrent` takes effect against an existing backlog instead of only applying to newly enqueued jobs.
- Reserve the `queue:` concurrency-key prefix: an explicit `concurrencyKey` may no longer start with it, so it cannot collide with a queue-derived key and silently change (or conflict with) an unrelated cap.
- Acquire the schema advisory lock before inspecting the `queue` column in its migration, matching the concurrency-column migration, to avoid SQL Server deadlocks with a concurrent `ALTER TABLE`.
- Document the `backgroundJobs.queues` configuration and the job `queue` API in `README.md` and `docs/background-jobs.md`.
