// @ts-check

/**
 * Default bound for one blocking advisory-lock acquisition.
 *
 * A blocking `acquireAdvisoryLock(name)` call with no explicit timeout used to park a pooled
 * connection for the driver's indefinite wait (MySQL/MariaDB: one year). One wedged holder — a
 * killed process, a runner that died while holding the lock, a connection that never returned —
 * then convoyed every later caller on the same lock name: the queue kept growing while every pool
 * connection sat in MariaDB's `User lock` state and no dispatch happened anywhere.
 *
 * The default is deliberately far above any contention observed in healthy production operation, so
 * a legitimate lock handover is never cut off, while a wedged holder stops stealing pool capacity
 * forever. Pass `null` explicitly to opt back in to the indefinite wait.
 * @type {number} */
export const DEFAULT_ADVISORY_LOCK_ACQUIRE_TIMEOUT_MS = 15 * 60 * 1000
