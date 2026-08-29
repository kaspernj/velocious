## Fixed

- Local background-job dispatcher drains no longer inherit a committed caller's database connection context, preventing stale transaction state during concurrent job execution.
- The background-jobs CLI now installs its shutdown handlers before reporting readiness, preventing supervisors from terminating an unprepared process.
