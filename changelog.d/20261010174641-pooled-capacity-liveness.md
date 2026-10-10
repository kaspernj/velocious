# Pooled runners keep capacity when a retirement wave empties the pool

The pooled-runner hard cap counts draining children, so when every live child
retired at once — for example all of them crossing the peak-RSS threshold after
the same memory burst — replacement spawns were deferred to each child's drain
and the worker advertised zero pooled capacity for the whole drain window, up
to the longest in-flight job. With long jobs (builds) that silently stalled
dispatch for tens of minutes even though the worker stayed healthy.

Retirement now keeps a bounded liveness replacement: when a retirement mark
leaves no non-retiring child at all, one replacement spawns over the hard cap
so advertised capacity never collapses to zero. Live children stay bounded at
`pooledRunnerCount + 1` and the extra child is absorbed by the next draining
exit. The worker logs a compact `pooled-capacity-liveness-spawn` line to its
stderr for that spawn, and a `pooled-capacity-starved` line if the bounded
exception is already exhausted and the pool must wait for a draining exit —
starvation is visible instead of silent.

The pooled-runner spec suite pins the bounded `+1`, the budget reuse after a
draining exit, and the starvation log, and the background-jobs docs describe
the bounded exception.
