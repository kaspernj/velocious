## Fixed

- Local background-job dispatcher drains no longer inherit a committed caller's database connection context, preventing stale transaction state during concurrent job execution.
- Persistent dispatcher and websocket publish queues no longer inherit a test attempt's revocable database-access scope.
- Recovery rollback no longer underflows logical transaction depth when it clears stale physical driver state.
- The background-jobs CLI now installs its shutdown handlers before reporting readiness, preventing supervisors from terminating an unprepared process.
