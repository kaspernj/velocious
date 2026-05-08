A `background-jobs-worker` process can now run multiple `forked: false` jobs concurrently inside the same Node process.

- `BackgroundJobsConfiguration` gains `maxConcurrentInlineJobs` (default: `4`).
- Configurable via the velocious config, the `BackgroundJobsWorker` constructor option, or the `VELOCIOUS_BACKGROUND_JOBS_MAX_CONCURRENT_INLINE_JOBS` env var.
- Concurrency is at the JS event-loop level — every inline job in flight shares the worker's process and DB connection pool, so the cap should fit the pool, not the CPU count. Forking remains the right tool for memory isolation across long-running jobs and for using more cores.
- A single slow inline job no longer serializes every other inline job behind it.
