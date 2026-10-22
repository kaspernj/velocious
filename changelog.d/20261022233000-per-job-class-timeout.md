---
title: Per-job-class wall-clock timeouts
slug: per-job-class-wall-clock-timeouts
date: 2026-10-22
---

# Per-job-class wall-clock timeouts

Job classes can now declare their own wall-clock bound with `static timeoutMs`, so each job
type carries the bound its work actually needs instead of every job in the system sharing one
worker-level `backgroundJobs.jobTimeoutMs`.

Precedence is per-enqueue `{timeoutMs}` → class `static timeoutMs` → worker-level
`backgroundJobs.jobTimeoutMs` → no bound. A class that declares nothing leaves the option
absent, so existing behavior is unchanged; a non-positive value at either level disables the
bound for that job or class.

Set each class's value well above that job type's longest legitimate run: the worker terminates
a job that exceeds its bound (SIGTERM, then SIGKILL after the reaping grace) and reports it
failed so the work requeues. A build runner that legitimately takes hours needs an hours-scale
bound, not a minutes-scale one — the bound catches a genuinely wedged runner, not a slow one.

See [Background jobs](background-jobs.md#per-job-class-wall-clock-timeouts).
