export type AdvisoryLockFileOwner = {
    /**
     * - PID of the holding process.
     */
    pid: number;
    /**
     * - Host of the holding process.
     */
    hostname: string;
    /**
     * - Unique id of the acquiring backend instance.
     */
    holderId: string;
    /**
     * - ISO timestamp of acquisition.
     */
    acquiredAt: string;
    /**
     * - ISO timestamp when the current lease expires without renewal.
     */
    leaseExpiresAt: string;
    /**
     * - Extra owner field: HTTP host (server lock only).
     */
    host?: string;
    /**
     * - Extra owner field: HTTP port (server lock only).
     */
    port?: number;
};
/**
 * Owner metadata written inside one file-lock directory.
 * @typedef {object} AdvisoryLockFileOwner
 * @property {number} pid - PID of the holding process.
 * @property {string} hostname - Host of the holding process.
 * @property {string} holderId - Unique id of the acquiring backend instance.
 * @property {string} acquiredAt - ISO timestamp of acquisition.
 * @property {string} leaseExpiresAt - ISO timestamp when the current lease expires without renewal.
 * @property {string} [host] - Extra owner field: HTTP host (server lock only).
 * @property {number} [port] - Extra owner field: HTTP port (server lock only).
 */
/**
 * Directory-based advisory-lock backend for the STC-210 `file` tier
 * (`docs/advisory-lock-backends.md` tier (d)). This generalizes the pattern
 * already used by `src/http-server/server-lock.js` and the Node SQLite
 * driver's filesystem layer into one reusable backend behind the shared
 * advisory-lock seam:
 *
 * - Atomic publication: a lock is claimed by `fs.mkdtemp` + `fs.rename` onto
 *   the stable lock path, so a losing candidate never observes or deletes a
 *   half-written owner record.
 * - Lease + renewal: each hold carries a `leaseMs` lease renewed on
 *   `renewIntervalMs` while held, so a holder that dies without releasing
 *   (or whose PID was recycled) is reclaimable once the lease expires.
 * - Staleness: a lock directory is stale when its owner metadata is
 *   unreadable, its lease expired, or its owner is a dead local process
 *   (`kill(pid, 0)` → `ESRCH`). Cross-host owners are only reclaimable via
 *   lease expiry because PID liveness cannot be probed remotely.
 *
 * This tier provides no fencing tokens (design §8: a file lock has no
 * monotonic authority a partitioned holder can be checked against), so
 * acquisitions report `fencingSupported: false` instead of pretending.
 */
export default class AdvisoryLockFileBackend {
    directory: string;
    extraOwnerFields: Record<string, string | number>;
    leaseMs: number;
    renewIntervalMs: number;
    pathStyle: "hashed" | "plain";
    pollIntervalMs: number;
    holderId: string;
    /** @type {Map<string, {timer: ReturnType<typeof setInterval>}>} */
    holdsByName: Map<string, {
        timer: ReturnType<typeof setInterval>;
    }>;
    /**
     * Creates one file-lock backend.
     * @param {object} args - Backend options.
     * @param {string} args.directory - Directory that holds the lock directories.
     * @param {Record<string, string | number>} [args.extraOwnerFields] - Extra fields merged into every owner metadata record (e.g. the HTTP server lock's host/port).
     * @param {number} [args.leaseMs] - Lease duration for one hold; expired leases make a lock stale. Defaults to 30000.
     * @param {number} [args.renewIntervalMs] - Renewal cadence while holding; must stay below `leaseMs`. Defaults to 10000.
     * @param {"hashed" | "plain"} [args.pathStyle] - `hashed` derives `<safeName>-<hash>.lock` names (advisory-lock tier); `plain` uses `<name>.lock` (HTTP server lock). Defaults to `hashed`.
     * @param {number} [args.pollIntervalMs] - Wait between acquisition retries. Defaults to 50.
     */
    constructor({ directory, extraOwnerFields, leaseMs, renewIntervalMs, pathStyle, pollIntervalMs }: {
        directory: string;
        extraOwnerFields?: Record<string, string | number>;
        leaseMs?: number;
        renewIntervalMs?: number;
        pathStyle?: "hashed" | "plain";
        pollIntervalMs?: number;
    });
    /**
     * Resolves the stable lock directory path for one lock name.
     * @param {string} name - Lock name.
     * @returns {string} - Filesystem path for the lock directory.
     */
    lockPathFor(name: string): string;
    /**
     * Blocks until the named lock is acquired or `timeoutMs` elapses.
     * @param {string} name - Lock name.
     * @param {{timeoutMs?: number | null}} [args] - Timeout args; `null`, `undefined`, or negative waits indefinitely.
     * @returns {Promise<boolean>} - True when acquired, false when the timeout elapsed.
     */
    acquire(name: string, { timeoutMs }?: {
        timeoutMs?: number | null;
    }): Promise<boolean>;
    /**
     * Attempts to acquire the named lock without waiting, reclaiming a stale
     * lock directory when one is found.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - True when this backend became the lock owner.
     */
    tryAcquire(name: string): Promise<boolean>;
    /**
     * Releases the lock only when this backend instance owns it, mirroring the
     * "you can only release locks you own" contract of the database tiers.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - True when the held lock was released.
     */
    release(name: string): Promise<boolean>;
    /**
     * Runs is held.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - Whether the lock is currently held by a live, unexpired owner.
     */
    isHeld(name: string): Promise<boolean>;
    /**
     * Reads the current owner metadata for diagnostics.
     * @param {string} name - Lock name.
     * @returns {Promise<AdvisoryLockFileOwner | null>} - Parsed owner metadata, when a lock directory exists.
     */
    holderInfo(name: string): Promise<AdvisoryLockFileOwner | null>;
    /**
     * Releases every lock this backend instance currently holds (shutdown path).
     * @returns {Promise<void>} - Resolves after best-effort release of all holds.
     */
    releaseAllHeld(): Promise<void>;
    /**
     * Ensures the parent lock directory exists.
     * @returns {Promise<void>} - Resolves after the directory exists.
     */
    ensureDirectory(): Promise<void>;
    /**
     * Publishes a fully initialized lock directory with one atomic rename so
     * concurrent candidates cannot observe a half-written owner record.
     * @param {string} lockPath - Stable lock directory path.
     * @returns {Promise<boolean>} - Whether this candidate became the lock owner.
     */
    publishLockDirectory(lockPath: string): Promise<boolean>;
    /**
     * Starts lease renewal for a freshly acquired hold.
     * @param {string} name - Lock name.
     * @returns {true} - Always true; the hold is now tracked.
     */
    startHold(name: string): true;
    /**
     * Extends this instance's lease on one held lock; stops renewing when the
     * directory is no longer ours (the lock was reclaimed).
     * @param {string} name - Lock name.
     * @returns {Promise<void>} - Resolves after the renewal attempt.
     */
    renewHold(name: string): Promise<void>;
    /**
     * Clears the renewal timer for one hold.
     * @param {string} name - Lock name.
     * @returns {void}
     */
    clearHold(name: string): void;
    /**
     * Writes owner + lease metadata into a lock directory.
     * @param {string} lockDirPath - Lock directory to write metadata into.
     * @returns {Promise<void>} - Resolves after metadata is written.
     */
    writeOwner(lockDirPath: string): Promise<void>;
    /**
     * Reads owner metadata from a lock directory.
     * @param {string} lockPath - Lock directory path.
     * @returns {Promise<AdvisoryLockFileOwner | null>} - Parsed owner metadata, when readable.
     */
    readOwner(lockPath: string): Promise<AdvisoryLockFileOwner | null>;
    /**
     * A lock directory is stale when its metadata is unreadable, its lease has
     * expired, or its owner is a dead process on this host. Cross-host owners
     * are only reclaimable via lease expiry — PID probing is unreliable beyond
     * one host, which is exactly why this tier is the opt-in single-host last
     * resort (design §4/§8).
     * @param {string} lockPath - Lock directory path.
     * @returns {Promise<boolean>} - Whether the lock can be reclaimed.
     */
    isStale(lockPath: string): Promise<boolean>;
}
//# sourceMappingURL=advisory-lock-file-backend.d.ts.map