# Background jobs main recovers from a never-settling drain store call

A background-jobs main could stop dispatching cluster-wide with no error at
all: the dispatch drain coalesces wake-ups into one promise, so a store call
that never settled (wedged DB connection, lost acknowledgement) froze the pass
forever — every later wake-up just awaited the stuck promise, `stop()` hung,
and operators had to kill the process by hand.

Drain-critical store operations — the queued-job lookup, the durable handoff
claim, and handoff-recovery transitions — are now bounded by a new
`backgroundJobs.drainStoreOperationTimeoutMs` (default 60 seconds) via
`awaitery`'s timeout helper. On timeout the drain fails into its existing
error/retry path, the bounded rejection releases the coalesced drain, and the
stall is reported on the framework-error channel
(`context.stage = "background-jobs-drain-stall"`). Dispatching resumes
automatically as soon as the store recovers, removing the manual-kill
requirement from the release lifecycle.

The new `main-drain-stall-recovery-spec.js` proves the bounds for a
never-settling lookup and a never-settling handoff claim (including exact-lease
recovery and resumed dispatch), and `docs/background-jobs.md` documents the
setting.
