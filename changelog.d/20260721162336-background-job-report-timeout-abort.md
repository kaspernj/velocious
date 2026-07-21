Background job status reports now cooperatively abort and destroy the pending socket when a report times out.

- `BackgroundJobsStatusReporter.report` threads the awaitery `TimeoutControl` signal into the socket request
- `BackgroundJobsSocketRequest.run` accepts an optional `AbortSignal`; on abort it removes its listeners, destroys (not merely ends) the pending socket, and rejects with the signal reason
- `BackgroundJobsStatusReporter` accepts an optional `attemptTimeoutMs` constructor option (defaults to the previous 5000ms) for deterministic timeout behavior
- the public awaitery `TimeoutError` behavior is preserved
