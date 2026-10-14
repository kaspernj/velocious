// @ts-check

import {DEFAULT_ADVISORY_LOCK_ACQUIRE_TIMEOUT_MS} from "../database/advisory-lock-bound.js"

/**
 * Default bound for one scheduled background-job enqueue attempt.
 *
 * A durable enqueue that never settles (wedged DB connection, advisory lock held by a dead process)
 * used to poison its schedule key forever: `BackgroundJobsScheduler` kept the in-flight promise in
 * `pendingEnqueuesByJobKey`, every later tick returned early, and shutdown could never drain. The
 * bound makes that stall observable and self-healing instead of silent.
 *
 * It is deliberately larger than the advisory-lock acquisition bound, because a scheduled enqueue
 * waits for a lock *and then* inserts. Keeping the enqueue watchdog outside the lock bound lets the
 * precise `AdvisoryLockTimeoutError` surface first — naming the lock that is actually stuck —
 * instead of a generic enqueue timeout that hides which lock caused the stall.
 * @type {number} */
export const DEFAULT_SCHEDULED_ENQUEUE_TIMEOUT_MS = DEFAULT_ADVISORY_LOCK_ACQUIRE_TIMEOUT_MS + 5 * 60 * 1000
