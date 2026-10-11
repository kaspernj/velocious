# Defer the last working pooled child's retirement instead of collapsing capacity

The bounded over-cap liveness replacement keeps one working child through a
full retirement wave, but when that replacement itself crossed its recycle
threshold while the original wave was still draining long jobs, retiring it
left the pool at its hard cap with zero working children and advertised
capacity at zero until the next draining exit — up to the longest in-flight
job. With build-sized jobs that stalled dispatch platform-wide for tens of
minutes at a time, repeatedly across a day (handoff freezes of 20–55 minutes),
even though the worker stayed healthy.

A retirement that would empty the working pool while the pool already carries
its bounded over-cap child is now deferred: the child keeps serving new work
and the retirement retries on a later observation, once a draining exit has
freed a cap slot for its replacement, so advertised capacity can no longer
collapse to zero inside a wave. Live children stay bounded at
`pooledRunnerCount + 1`, the exit-path restore remains the safety net for a
replacement that dies rather than retires while the wave still drains, and the
deferral logs a compact `pooled-capacity-retirement-deferred` line to the
worker's stderr.

The pooled-runner spec suite pins the deferral, its retry after a freed slot,
and the unchanged over-cap budget, and the background-jobs docs describe the
deferral.
