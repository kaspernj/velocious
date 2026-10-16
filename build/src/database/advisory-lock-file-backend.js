// @ts-check
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import wait from "awaitery/build/wait.js";
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
    constructor({ directory, extraOwnerFields = {}, leaseMs = 30_000, renewIntervalMs = 10_000, pathStyle = "hashed", pollIntervalMs = 50 }) {
        this.directory = directory;
        this.extraOwnerFields = extraOwnerFields;
        this.leaseMs = leaseMs;
        this.renewIntervalMs = renewIntervalMs;
        this.pathStyle = pathStyle;
        this.pollIntervalMs = pollIntervalMs;
        this.holderId = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        /** @type {Map<string, {timer: ReturnType<typeof setInterval>}>} */
        this.holdsByName = new Map();
    }
    /**
     * Resolves the stable lock directory path for one lock name.
     * @param {string} name - Lock name.
     * @returns {string} - Filesystem path for the lock directory.
     */
    lockPathFor(name) {
        if (this.pathStyle === "plain")
            return path.join(this.directory, `${name}.lock`);
        const hash = createHash("sha256").update(name).digest("hex").slice(0, 16);
        const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64);
        return path.join(this.directory, `${safeName}-${hash}.lock`);
    }
    /**
     * Blocks until the named lock is acquired or `timeoutMs` elapses.
     * @param {string} name - Lock name.
     * @param {{timeoutMs?: number | null}} [args] - Timeout args; `null`, `undefined`, or negative waits indefinitely.
     * @returns {Promise<boolean>} - True when acquired, false when the timeout elapsed.
     */
    async acquire(name, { timeoutMs } = {}) {
        const deadline = typeof timeoutMs === "number" && timeoutMs >= 0 ? Date.now() + timeoutMs : null;
        await this.ensureDirectory();
        // Intentionally looping without a fixed iteration cap — either the
        // publication succeeds, the deadline elapses, or an unexpected error is
        // re-thrown.
        while (true) {
            if (await this.tryAcquire(name))
                return true;
            if (deadline !== null) {
                const remaining = deadline - Date.now();
                if (remaining <= 0)
                    return false;
                await wait(Math.min(this.pollIntervalMs, remaining));
            }
            else {
                await wait(this.pollIntervalMs);
            }
        }
    }
    /**
     * Attempts to acquire the named lock without waiting, reclaiming a stale
     * lock directory when one is found.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - True when this backend became the lock owner.
     */
    async tryAcquire(name) {
        if (this.holdsByName.has(name))
            return false;
        await this.ensureDirectory();
        const lockPath = this.lockPathFor(name);
        if (await this.publishLockDirectory(lockPath))
            return this.startHold(name);
        if (await this.isStale(lockPath)) {
            await fs.rm(lockPath, { recursive: true, force: true });
            if (await this.publishLockDirectory(lockPath))
                return this.startHold(name);
        }
        return false;
    }
    /**
     * Releases the lock only when this backend instance owns it, mirroring the
     * "you can only release locks you own" contract of the database tiers.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - True when the held lock was released.
     */
    async release(name) {
        const hold = this.holdsByName.get(name);
        if (!hold)
            return false;
        this.clearHold(name);
        const owner = await this.readOwner(this.lockPathFor(name));
        if (!owner || owner.holderId !== this.holderId)
            return false;
        await fs.rm(this.lockPathFor(name), { recursive: true, force: true });
        return true;
    }
    /**
     * Runs is held.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - Whether the lock is currently held by a live, unexpired owner.
     */
    async isHeld(name) {
        const lockPath = this.lockPathFor(name);
        try {
            await fs.stat(lockPath);
        }
        catch {
            return false;
        }
        return !await this.isStale(lockPath);
    }
    /**
     * Reads the current owner metadata for diagnostics.
     * @param {string} name - Lock name.
     * @returns {Promise<AdvisoryLockFileOwner | null>} - Parsed owner metadata, when a lock directory exists.
     */
    async holderInfo(name) {
        return await this.readOwner(this.lockPathFor(name));
    }
    /**
     * Releases every lock this backend instance currently holds (shutdown path).
     * @returns {Promise<void>} - Resolves after best-effort release of all holds.
     */
    async releaseAllHeld() {
        for (const name of [...this.holdsByName.keys()]) {
            await this.release(name);
        }
    }
    /**
     * Ensures the parent lock directory exists.
     * @returns {Promise<void>} - Resolves after the directory exists.
     */
    async ensureDirectory() {
        await fs.mkdir(this.directory, { recursive: true });
    }
    /**
     * Publishes a fully initialized lock directory with one atomic rename so
     * concurrent candidates cannot observe a half-written owner record.
     * @param {string} lockPath - Stable lock directory path.
     * @returns {Promise<boolean>} - Whether this candidate became the lock owner.
     */
    async publishLockDirectory(lockPath) {
        const candidatePath = await fs.mkdtemp(`${lockPath}.pending-`);
        let published = false;
        try {
            await this.writeOwner(candidatePath);
            try {
                await fs.rename(candidatePath, lockPath);
                published = true;
                return true;
            }
            catch (error) {
                const code = /** @type {Error & {code?: string}} */ (error)?.code;
                if (code === "EEXIST" || code === "ENOTEMPTY")
                    return false;
                throw error;
            }
        }
        finally {
            if (!published)
                await fs.rm(candidatePath, { recursive: true, force: true });
        }
    }
    /**
     * Starts lease renewal for a freshly acquired hold.
     * @param {string} name - Lock name.
     * @returns {true} - Always true; the hold is now tracked.
     */
    startHold(name) {
        const timer = setInterval(() => {
            void this.renewHold(name);
        }, this.renewIntervalMs);
        if (typeof timer.unref === "function")
            timer.unref();
        this.holdsByName.set(name, { timer });
        return true;
    }
    /**
     * Extends this instance's lease on one held lock; stops renewing when the
     * directory is no longer ours (the lock was reclaimed).
     * @param {string} name - Lock name.
     * @returns {Promise<void>} - Resolves after the renewal attempt.
     */
    async renewHold(name) {
        const hold = this.holdsByName.get(name);
        if (!hold)
            return;
        const owner = await this.readOwner(this.lockPathFor(name));
        if (!owner || owner.holderId !== this.holderId) {
            this.clearHold(name);
            return;
        }
        await this.writeOwner(this.lockPathFor(name));
    }
    /**
     * Clears the renewal timer for one hold.
     * @param {string} name - Lock name.
     * @returns {void}
     */
    clearHold(name) {
        const hold = this.holdsByName.get(name);
        if (!hold)
            return;
        clearInterval(hold.timer);
        this.holdsByName.delete(name);
    }
    /**
     * Writes owner + lease metadata into a lock directory.
     * @param {string} lockDirPath - Lock directory to write metadata into.
     * @returns {Promise<void>} - Resolves after metadata is written.
     */
    async writeOwner(lockDirPath) {
        /** @type {AdvisoryLockFileOwner} */
        const owner = {
            acquiredAt: new Date().toISOString(),
            holderId: this.holderId,
            hostname: os.hostname(),
            leaseExpiresAt: new Date(Date.now() + this.leaseMs).toISOString(),
            pid: process.pid,
            ...this.extraOwnerFields
        };
        await fs.writeFile(path.join(lockDirPath, "owner.json"), JSON.stringify(owner));
    }
    /**
     * Reads owner metadata from a lock directory.
     * @param {string} lockPath - Lock directory path.
     * @returns {Promise<AdvisoryLockFileOwner | null>} - Parsed owner metadata, when readable.
     */
    async readOwner(lockPath) {
        /** @type {string} */
        let rawOwner;
        try {
            rawOwner = await fs.readFile(path.join(lockPath, "owner.json"), "utf8");
        }
        catch {
            return null;
        }
        try {
            return /** @type {AdvisoryLockFileOwner} */ (JSON.parse(rawOwner));
        }
        catch {
            return null;
        }
    }
    /**
     * A lock directory is stale when its metadata is unreadable, its lease has
     * expired, or its owner is a dead process on this host. Cross-host owners
     * are only reclaimable via lease expiry — PID probing is unreliable beyond
     * one host, which is exactly why this tier is the opt-in single-host last
     * resort (design §4/§8).
     * @param {string} lockPath - Lock directory path.
     * @returns {Promise<boolean>} - Whether the lock can be reclaimed.
     */
    async isStale(lockPath) {
        const owner = await this.readOwner(lockPath);
        if (!owner || typeof owner.pid !== "number")
            return true;
        if (owner.leaseExpiresAt && new Date(owner.leaseExpiresAt).getTime() <= Date.now())
            return true;
        if (owner.hostname && owner.hostname !== os.hostname())
            return false;
        try {
            // `kill(pid, 0)` is a no-op signal that fails with ESRCH when the
            // process is gone; permission errors still prove the process exists.
            process.kill(owner.pid, 0);
            return false;
        }
        catch (error) {
            return /** @type {Error & {code?: string}} */ (error).code === "ESRCH";
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWR2aXNvcnktbG9jay1maWxlLWJhY2tlbmQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZGF0YWJhc2UvYWR2aXNvcnktbG9jay1maWxlLWJhY2tlbmQuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyxVQUFVLEVBQUMsTUFBTSxhQUFhLENBQUE7QUFDdEMsT0FBTyxFQUFFLE1BQU0sa0JBQWtCLENBQUE7QUFDakMsT0FBTyxFQUFFLE1BQU0sU0FBUyxDQUFBO0FBQ3hCLE9BQU8sSUFBSSxNQUFNLFdBQVcsQ0FBQTtBQUM1QixPQUFPLElBQUksTUFBTSx3QkFBd0IsQ0FBQTtBQUV6Qzs7Ozs7Ozs7OztHQVVHO0FBRUg7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXFCRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sdUJBQXVCO0lBQzFDOzs7Ozs7Ozs7T0FTRztJQUNILFlBQVksRUFBQyxTQUFTLEVBQUUsZ0JBQWdCLEdBQUcsRUFBRSxFQUFFLE9BQU8sR0FBRyxNQUFNLEVBQUUsZUFBZSxHQUFHLE1BQU0sRUFBRSxTQUFTLEdBQUcsUUFBUSxFQUFFLGNBQWMsR0FBRyxFQUFFLEVBQUM7UUFDbkksSUFBSSxDQUFDLFNBQVMsR0FBRyxTQUFTLENBQUE7UUFDMUIsSUFBSSxDQUFDLGdCQUFnQixHQUFHLGdCQUFnQixDQUFBO1FBQ3hDLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFBO1FBQ3RCLElBQUksQ0FBQyxlQUFlLEdBQUcsZUFBZSxDQUFBO1FBQ3RDLElBQUksQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFBO1FBQzFCLElBQUksQ0FBQyxjQUFjLEdBQUcsY0FBYyxDQUFBO1FBQ3BDLElBQUksQ0FBQyxRQUFRLEdBQUcsR0FBRyxPQUFPLENBQUMsR0FBRyxJQUFJLElBQUksQ0FBQyxHQUFHLEVBQUUsSUFBSSxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLEVBQUUsQ0FBQTtRQUN6RixtRUFBbUU7UUFDbkUsSUFBSSxDQUFDLFdBQVcsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO0lBQzlCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsV0FBVyxDQUFDLElBQUk7UUFDZCxJQUFJLElBQUksQ0FBQyxTQUFTLEtBQUssT0FBTztZQUFFLE9BQU8sSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLEdBQUcsSUFBSSxPQUFPLENBQUMsQ0FBQTtRQUVoRixNQUFNLElBQUksR0FBRyxVQUFVLENBQUMsUUFBUSxDQUFDLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFBO1FBQ3pFLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsa0JBQWtCLEVBQUUsR0FBRyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQTtRQUVuRSxPQUFPLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxHQUFHLFFBQVEsSUFBSSxJQUFJLE9BQU8sQ0FBQyxDQUFBO0lBQzlELENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLEVBQUMsU0FBUyxFQUFDLEdBQUcsRUFBRTtRQUNsQyxNQUFNLFFBQVEsR0FBRyxPQUFPLFNBQVMsS0FBSyxRQUFRLElBQUksU0FBUyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLFNBQVMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFBO1FBRWhHLE1BQU0sSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFBO1FBRTVCLG1FQUFtRTtRQUNuRSx3RUFBd0U7UUFDeEUsYUFBYTtRQUNiLE9BQU8sSUFBSSxFQUFFLENBQUM7WUFDWixJQUFJLE1BQU0sSUFBSSxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUM7Z0JBQUUsT0FBTyxJQUFJLENBQUE7WUFFNUMsSUFBSSxRQUFRLEtBQUssSUFBSSxFQUFFLENBQUM7Z0JBQ3RCLE1BQU0sU0FBUyxHQUFHLFFBQVEsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUE7Z0JBRXZDLElBQUksU0FBUyxJQUFJLENBQUM7b0JBQUUsT0FBTyxLQUFLLENBQUE7Z0JBRWhDLE1BQU0sSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLGNBQWMsRUFBRSxTQUFTLENBQUMsQ0FBQyxDQUFBO1lBQ3RELENBQUM7aUJBQU0sQ0FBQztnQkFDTixNQUFNLElBQUksQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUE7WUFDakMsQ0FBQztRQUNILENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsVUFBVSxDQUFDLElBQUk7UUFDbkIsSUFBSSxJQUFJLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUM7WUFBRSxPQUFPLEtBQUssQ0FBQTtRQUU1QyxNQUFNLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQTtRQUU1QixNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxDQUFBO1FBRXZDLElBQUksTUFBTSxJQUFJLENBQUMsb0JBQW9CLENBQUMsUUFBUSxDQUFDO1lBQUUsT0FBTyxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxDQUFBO1FBRTFFLElBQUksTUFBTSxJQUFJLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUM7WUFDakMsTUFBTSxFQUFFLENBQUMsRUFBRSxDQUFDLFFBQVEsRUFBRSxFQUFDLFNBQVMsRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7WUFFckQsSUFBSSxNQUFNLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxRQUFRLENBQUM7Z0JBQUUsT0FBTyxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxDQUFBO1FBQzVFLENBQUM7UUFFRCxPQUFPLEtBQUssQ0FBQTtJQUNkLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSTtRQUNoQixNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUV2QyxJQUFJLENBQUMsSUFBSTtZQUFFLE9BQU8sS0FBSyxDQUFBO1FBRXZCLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLENBQUE7UUFFcEIsTUFBTSxLQUFLLEdBQUcsTUFBTSxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQTtRQUUxRCxJQUFJLENBQUMsS0FBSyxJQUFJLEtBQUssQ0FBQyxRQUFRLEtBQUssSUFBSSxDQUFDLFFBQVE7WUFBRSxPQUFPLEtBQUssQ0FBQTtRQUU1RCxNQUFNLEVBQUUsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsRUFBRSxFQUFDLFNBQVMsRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7UUFFbkUsT0FBTyxJQUFJLENBQUE7SUFDYixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxNQUFNLENBQUMsSUFBSTtRQUNmLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLENBQUE7UUFFdkMsSUFBSSxDQUFDO1lBQ0gsTUFBTSxFQUFFLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBQ3pCLENBQUM7UUFBQyxNQUFNLENBQUM7WUFDUCxPQUFPLEtBQUssQ0FBQTtRQUNkLENBQUM7UUFFRCxPQUFPLENBQUMsTUFBTSxJQUFJLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxDQUFBO0lBQ3RDLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLFVBQVUsQ0FBQyxJQUFJO1FBQ25CLE9BQU8sTUFBTSxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQTtJQUNyRCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLGNBQWM7UUFDbEIsS0FBSyxNQUFNLElBQUksSUFBSSxDQUFDLEdBQUcsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxFQUFFLENBQUM7WUFDaEQsTUFBTSxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFBO1FBQzFCLENBQUM7SUFDSCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLGVBQWU7UUFDbkIsTUFBTSxFQUFFLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsRUFBQyxTQUFTLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtJQUNuRCxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsb0JBQW9CLENBQUMsUUFBUTtRQUNqQyxNQUFNLGFBQWEsR0FBRyxNQUFNLEVBQUUsQ0FBQyxPQUFPLENBQUMsR0FBRyxRQUFRLFdBQVcsQ0FBQyxDQUFBO1FBQzlELElBQUksU0FBUyxHQUFHLEtBQUssQ0FBQTtRQUVyQixJQUFJLENBQUM7WUFDSCxNQUFNLElBQUksQ0FBQyxVQUFVLENBQUMsYUFBYSxDQUFDLENBQUE7WUFFcEMsSUFBSSxDQUFDO2dCQUNILE1BQU0sRUFBRSxDQUFDLE1BQU0sQ0FBQyxhQUFhLEVBQUUsUUFBUSxDQUFDLENBQUE7Z0JBQ3hDLFNBQVMsR0FBRyxJQUFJLENBQUE7Z0JBQ2hCLE9BQU8sSUFBSSxDQUFBO1lBQ2IsQ0FBQztZQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7Z0JBQ2YsTUFBTSxJQUFJLEdBQUcsc0NBQXNDLENBQUMsQ0FBQyxLQUFLLENBQUMsRUFBRSxJQUFJLENBQUE7Z0JBRWpFLElBQUksSUFBSSxLQUFLLFFBQVEsSUFBSSxJQUFJLEtBQUssV0FBVztvQkFBRSxPQUFPLEtBQUssQ0FBQTtnQkFDM0QsTUFBTSxLQUFLLENBQUE7WUFDYixDQUFDO1FBQ0gsQ0FBQztnQkFBUyxDQUFDO1lBQ1QsSUFBSSxDQUFDLFNBQVM7Z0JBQUUsTUFBTSxFQUFFLENBQUMsRUFBRSxDQUFDLGFBQWEsRUFBRSxFQUFDLFNBQVMsRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7UUFDNUUsQ0FBQztJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsU0FBUyxDQUFDLElBQUk7UUFDWixNQUFNLEtBQUssR0FBRyxXQUFXLENBQUMsR0FBRyxFQUFFO1lBQzdCLEtBQUssSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUMzQixDQUFDLEVBQUUsSUFBSSxDQUFDLGVBQWUsQ0FBQyxDQUFBO1FBRXhCLElBQUksT0FBTyxLQUFLLENBQUMsS0FBSyxLQUFLLFVBQVU7WUFBRSxLQUFLLENBQUMsS0FBSyxFQUFFLENBQUE7UUFFcEQsSUFBSSxDQUFDLFdBQVcsQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLEVBQUMsS0FBSyxFQUFDLENBQUMsQ0FBQTtRQUVuQyxPQUFPLElBQUksQ0FBQTtJQUNiLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxTQUFTLENBQUMsSUFBSTtRQUNsQixNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUV2QyxJQUFJLENBQUMsSUFBSTtZQUFFLE9BQU07UUFFakIsTUFBTSxLQUFLLEdBQUcsTUFBTSxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQTtRQUUxRCxJQUFJLENBQUMsS0FBSyxJQUFJLEtBQUssQ0FBQyxRQUFRLEtBQUssSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBQy9DLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLENBQUE7WUFDcEIsT0FBTTtRQUNSLENBQUM7UUFFRCxNQUFNLElBQUksQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFBO0lBQy9DLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsU0FBUyxDQUFDLElBQUk7UUFDWixNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUV2QyxJQUFJLENBQUMsSUFBSTtZQUFFLE9BQU07UUFFakIsYUFBYSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUN6QixJQUFJLENBQUMsV0FBVyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQTtJQUMvQixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxVQUFVLENBQUMsV0FBVztRQUMxQixvQ0FBb0M7UUFDcEMsTUFBTSxLQUFLLEdBQUc7WUFDWixVQUFVLEVBQUUsSUFBSSxJQUFJLEVBQUUsQ0FBQyxXQUFXLEVBQUU7WUFDcEMsUUFBUSxFQUFFLElBQUksQ0FBQyxRQUFRO1lBQ3ZCLFFBQVEsRUFBRSxFQUFFLENBQUMsUUFBUSxFQUFFO1lBQ3ZCLGNBQWMsRUFBRSxJQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDLFdBQVcsRUFBRTtZQUNqRSxHQUFHLEVBQUUsT0FBTyxDQUFDLEdBQUc7WUFDaEIsR0FBRyxJQUFJLENBQUMsZ0JBQWdCO1NBQ3pCLENBQUE7UUFFRCxNQUFNLEVBQUUsQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxXQUFXLEVBQUUsWUFBWSxDQUFDLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFBO0lBQ2pGLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLFNBQVMsQ0FBQyxRQUFRO1FBQ3RCLHFCQUFxQjtRQUNyQixJQUFJLFFBQVEsQ0FBQTtRQUVaLElBQUksQ0FBQztZQUNILFFBQVEsR0FBRyxNQUFNLEVBQUUsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsWUFBWSxDQUFDLEVBQUUsTUFBTSxDQUFDLENBQUE7UUFDekUsQ0FBQztRQUFDLE1BQU0sQ0FBQztZQUNQLE9BQU8sSUFBSSxDQUFBO1FBQ2IsQ0FBQztRQUVELElBQUksQ0FBQztZQUNILE9BQU8sb0NBQW9DLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUE7UUFDcEUsQ0FBQztRQUFDLE1BQU0sQ0FBQztZQUNQLE9BQU8sSUFBSSxDQUFBO1FBQ2IsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7Ozs7T0FRRztJQUNILEtBQUssQ0FBQyxPQUFPLENBQUMsUUFBUTtRQUNwQixNQUFNLEtBQUssR0FBRyxNQUFNLElBQUksQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDLENBQUE7UUFFNUMsSUFBSSxDQUFDLEtBQUssSUFBSSxPQUFPLEtBQUssQ0FBQyxHQUFHLEtBQUssUUFBUTtZQUFFLE9BQU8sSUFBSSxDQUFBO1FBRXhELElBQUksS0FBSyxDQUFDLGNBQWMsSUFBSSxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUMsY0FBYyxDQUFDLENBQUMsT0FBTyxFQUFFLElBQUksSUFBSSxDQUFDLEdBQUcsRUFBRTtZQUFFLE9BQU8sSUFBSSxDQUFBO1FBRS9GLElBQUksS0FBSyxDQUFDLFFBQVEsSUFBSSxLQUFLLENBQUMsUUFBUSxLQUFLLEVBQUUsQ0FBQyxRQUFRLEVBQUU7WUFBRSxPQUFPLEtBQUssQ0FBQTtRQUVwRSxJQUFJLENBQUM7WUFDSCxrRUFBa0U7WUFDbEUscUVBQXFFO1lBQ3JFLE9BQU8sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsQ0FBQTtZQUUxQixPQUFPLEtBQUssQ0FBQTtRQUNkLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsT0FBTyxzQ0FBc0MsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksS0FBSyxPQUFPLENBQUE7UUFDeEUsQ0FBQztJQUNILENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge2NyZWF0ZUhhc2h9IGZyb20gXCJub2RlOmNyeXB0b1wiXG5pbXBvcnQgZnMgZnJvbSBcIm5vZGU6ZnMvcHJvbWlzZXNcIlxuaW1wb3J0IG9zIGZyb20gXCJub2RlOm9zXCJcbmltcG9ydCBwYXRoIGZyb20gXCJub2RlOnBhdGhcIlxuaW1wb3J0IHdhaXQgZnJvbSBcImF3YWl0ZXJ5L2J1aWxkL3dhaXQuanNcIlxuXG4vKipcbiAqIE93bmVyIG1ldGFkYXRhIHdyaXR0ZW4gaW5zaWRlIG9uZSBmaWxlLWxvY2sgZGlyZWN0b3J5LlxuICogQHR5cGVkZWYge29iamVjdH0gQWR2aXNvcnlMb2NrRmlsZU93bmVyXG4gKiBAcHJvcGVydHkge251bWJlcn0gcGlkIC0gUElEIG9mIHRoZSBob2xkaW5nIHByb2Nlc3MuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gaG9zdG5hbWUgLSBIb3N0IG9mIHRoZSBob2xkaW5nIHByb2Nlc3MuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gaG9sZGVySWQgLSBVbmlxdWUgaWQgb2YgdGhlIGFjcXVpcmluZyBiYWNrZW5kIGluc3RhbmNlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGFjcXVpcmVkQXQgLSBJU08gdGltZXN0YW1wIG9mIGFjcXVpc2l0aW9uLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGxlYXNlRXhwaXJlc0F0IC0gSVNPIHRpbWVzdGFtcCB3aGVuIHRoZSBjdXJyZW50IGxlYXNlIGV4cGlyZXMgd2l0aG91dCByZW5ld2FsLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtob3N0XSAtIEV4dHJhIG93bmVyIGZpZWxkOiBIVFRQIGhvc3QgKHNlcnZlciBsb2NrIG9ubHkpLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtwb3J0XSAtIEV4dHJhIG93bmVyIGZpZWxkOiBIVFRQIHBvcnQgKHNlcnZlciBsb2NrIG9ubHkpLlxuICovXG5cbi8qKlxuICogRGlyZWN0b3J5LWJhc2VkIGFkdmlzb3J5LWxvY2sgYmFja2VuZCBmb3IgdGhlIFNUQy0yMTAgYGZpbGVgIHRpZXJcbiAqIChgZG9jcy9hZHZpc29yeS1sb2NrLWJhY2tlbmRzLm1kYCB0aWVyIChkKSkuIFRoaXMgZ2VuZXJhbGl6ZXMgdGhlIHBhdHRlcm5cbiAqIGFscmVhZHkgdXNlZCBieSBgc3JjL2h0dHAtc2VydmVyL3NlcnZlci1sb2NrLmpzYCBhbmQgdGhlIE5vZGUgU1FMaXRlXG4gKiBkcml2ZXIncyBmaWxlc3lzdGVtIGxheWVyIGludG8gb25lIHJldXNhYmxlIGJhY2tlbmQgYmVoaW5kIHRoZSBzaGFyZWRcbiAqIGFkdmlzb3J5LWxvY2sgc2VhbTpcbiAqXG4gKiAtIEF0b21pYyBwdWJsaWNhdGlvbjogYSBsb2NrIGlzIGNsYWltZWQgYnkgYGZzLm1rZHRlbXBgICsgYGZzLnJlbmFtZWAgb250b1xuICogICB0aGUgc3RhYmxlIGxvY2sgcGF0aCwgc28gYSBsb3NpbmcgY2FuZGlkYXRlIG5ldmVyIG9ic2VydmVzIG9yIGRlbGV0ZXMgYVxuICogICBoYWxmLXdyaXR0ZW4gb3duZXIgcmVjb3JkLlxuICogLSBMZWFzZSArIHJlbmV3YWw6IGVhY2ggaG9sZCBjYXJyaWVzIGEgYGxlYXNlTXNgIGxlYXNlIHJlbmV3ZWQgb25cbiAqICAgYHJlbmV3SW50ZXJ2YWxNc2Agd2hpbGUgaGVsZCwgc28gYSBob2xkZXIgdGhhdCBkaWVzIHdpdGhvdXQgcmVsZWFzaW5nXG4gKiAgIChvciB3aG9zZSBQSUQgd2FzIHJlY3ljbGVkKSBpcyByZWNsYWltYWJsZSBvbmNlIHRoZSBsZWFzZSBleHBpcmVzLlxuICogLSBTdGFsZW5lc3M6IGEgbG9jayBkaXJlY3RvcnkgaXMgc3RhbGUgd2hlbiBpdHMgb3duZXIgbWV0YWRhdGEgaXNcbiAqICAgdW5yZWFkYWJsZSwgaXRzIGxlYXNlIGV4cGlyZWQsIG9yIGl0cyBvd25lciBpcyBhIGRlYWQgbG9jYWwgcHJvY2Vzc1xuICogICAoYGtpbGwocGlkLCAwKWAg4oaSIGBFU1JDSGApLiBDcm9zcy1ob3N0IG93bmVycyBhcmUgb25seSByZWNsYWltYWJsZSB2aWFcbiAqICAgbGVhc2UgZXhwaXJ5IGJlY2F1c2UgUElEIGxpdmVuZXNzIGNhbm5vdCBiZSBwcm9iZWQgcmVtb3RlbHkuXG4gKlxuICogVGhpcyB0aWVyIHByb3ZpZGVzIG5vIGZlbmNpbmcgdG9rZW5zIChkZXNpZ24gwqc4OiBhIGZpbGUgbG9jayBoYXMgbm9cbiAqIG1vbm90b25pYyBhdXRob3JpdHkgYSBwYXJ0aXRpb25lZCBob2xkZXIgY2FuIGJlIGNoZWNrZWQgYWdhaW5zdCksIHNvXG4gKiBhY3F1aXNpdGlvbnMgcmVwb3J0IGBmZW5jaW5nU3VwcG9ydGVkOiBmYWxzZWAgaW5zdGVhZCBvZiBwcmV0ZW5kaW5nLlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBBZHZpc29yeUxvY2tGaWxlQmFja2VuZCB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIG9uZSBmaWxlLWxvY2sgYmFja2VuZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBCYWNrZW5kIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmRpcmVjdG9yeSAtIERpcmVjdG9yeSB0aGF0IGhvbGRzIHRoZSBsb2NrIGRpcmVjdG9yaWVzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlcj59IFthcmdzLmV4dHJhT3duZXJGaWVsZHNdIC0gRXh0cmEgZmllbGRzIG1lcmdlZCBpbnRvIGV2ZXJ5IG93bmVyIG1ldGFkYXRhIHJlY29yZCAoZS5nLiB0aGUgSFRUUCBzZXJ2ZXIgbG9jaydzIGhvc3QvcG9ydCkuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5sZWFzZU1zXSAtIExlYXNlIGR1cmF0aW9uIGZvciBvbmUgaG9sZDsgZXhwaXJlZCBsZWFzZXMgbWFrZSBhIGxvY2sgc3RhbGUuIERlZmF1bHRzIHRvIDMwMDAwLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucmVuZXdJbnRlcnZhbE1zXSAtIFJlbmV3YWwgY2FkZW5jZSB3aGlsZSBob2xkaW5nOyBtdXN0IHN0YXkgYmVsb3cgYGxlYXNlTXNgLiBEZWZhdWx0cyB0byAxMDAwMC5cbiAgICogQHBhcmFtIHtcImhhc2hlZFwiIHwgXCJwbGFpblwifSBbYXJncy5wYXRoU3R5bGVdIC0gYGhhc2hlZGAgZGVyaXZlcyBgPHNhZmVOYW1lPi08aGFzaD4ubG9ja2AgbmFtZXMgKGFkdmlzb3J5LWxvY2sgdGllcik7IGBwbGFpbmAgdXNlcyBgPG5hbWU+LmxvY2tgIChIVFRQIHNlcnZlciBsb2NrKS4gRGVmYXVsdHMgdG8gYGhhc2hlZGAuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5wb2xsSW50ZXJ2YWxNc10gLSBXYWl0IGJldHdlZW4gYWNxdWlzaXRpb24gcmV0cmllcy4gRGVmYXVsdHMgdG8gNTAuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7ZGlyZWN0b3J5LCBleHRyYU93bmVyRmllbGRzID0ge30sIGxlYXNlTXMgPSAzMF8wMDAsIHJlbmV3SW50ZXJ2YWxNcyA9IDEwXzAwMCwgcGF0aFN0eWxlID0gXCJoYXNoZWRcIiwgcG9sbEludGVydmFsTXMgPSA1MH0pIHtcbiAgICB0aGlzLmRpcmVjdG9yeSA9IGRpcmVjdG9yeVxuICAgIHRoaXMuZXh0cmFPd25lckZpZWxkcyA9IGV4dHJhT3duZXJGaWVsZHNcbiAgICB0aGlzLmxlYXNlTXMgPSBsZWFzZU1zXG4gICAgdGhpcy5yZW5ld0ludGVydmFsTXMgPSByZW5ld0ludGVydmFsTXNcbiAgICB0aGlzLnBhdGhTdHlsZSA9IHBhdGhTdHlsZVxuICAgIHRoaXMucG9sbEludGVydmFsTXMgPSBwb2xsSW50ZXJ2YWxNc1xuICAgIHRoaXMuaG9sZGVySWQgPSBgJHtwcm9jZXNzLnBpZH0tJHtEYXRlLm5vdygpfS0ke01hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnNsaWNlKDIsIDEwKX1gXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCB7dGltZXI6IFJldHVyblR5cGU8dHlwZW9mIHNldEludGVydmFsPn0+fSAqL1xuICAgIHRoaXMuaG9sZHNCeU5hbWUgPSBuZXcgTWFwKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgc3RhYmxlIGxvY2sgZGlyZWN0b3J5IHBhdGggZm9yIG9uZSBsb2NrIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEZpbGVzeXN0ZW0gcGF0aCBmb3IgdGhlIGxvY2sgZGlyZWN0b3J5LlxuICAgKi9cbiAgbG9ja1BhdGhGb3IobmFtZSkge1xuICAgIGlmICh0aGlzLnBhdGhTdHlsZSA9PT0gXCJwbGFpblwiKSByZXR1cm4gcGF0aC5qb2luKHRoaXMuZGlyZWN0b3J5LCBgJHtuYW1lfS5sb2NrYClcblxuICAgIGNvbnN0IGhhc2ggPSBjcmVhdGVIYXNoKFwic2hhMjU2XCIpLnVwZGF0ZShuYW1lKS5kaWdlc3QoXCJoZXhcIikuc2xpY2UoMCwgMTYpXG4gICAgY29uc3Qgc2FmZU5hbWUgPSBuYW1lLnJlcGxhY2UoL1teYS16QS1aMC05Ll8tXS9nLCBcIl9cIikuc2xpY2UoMCwgNjQpXG5cbiAgICByZXR1cm4gcGF0aC5qb2luKHRoaXMuZGlyZWN0b3J5LCBgJHtzYWZlTmFtZX0tJHtoYXNofS5sb2NrYClcbiAgfVxuXG4gIC8qKlxuICAgKiBCbG9ja3MgdW50aWwgdGhlIG5hbWVkIGxvY2sgaXMgYWNxdWlyZWQgb3IgYHRpbWVvdXRNc2AgZWxhcHNlcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEBwYXJhbSB7e3RpbWVvdXRNcz86IG51bWJlciB8IG51bGx9fSBbYXJnc10gLSBUaW1lb3V0IGFyZ3M7IGBudWxsYCwgYHVuZGVmaW5lZGAsIG9yIG5lZ2F0aXZlIHdhaXRzIGluZGVmaW5pdGVseS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gVHJ1ZSB3aGVuIGFjcXVpcmVkLCBmYWxzZSB3aGVuIHRoZSB0aW1lb3V0IGVsYXBzZWQuXG4gICAqL1xuICBhc3luYyBhY3F1aXJlKG5hbWUsIHt0aW1lb3V0TXN9ID0ge30pIHtcbiAgICBjb25zdCBkZWFkbGluZSA9IHR5cGVvZiB0aW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgdGltZW91dE1zID49IDAgPyBEYXRlLm5vdygpICsgdGltZW91dE1zIDogbnVsbFxuXG4gICAgYXdhaXQgdGhpcy5lbnN1cmVEaXJlY3RvcnkoKVxuXG4gICAgLy8gSW50ZW50aW9uYWxseSBsb29waW5nIHdpdGhvdXQgYSBmaXhlZCBpdGVyYXRpb24gY2FwIOKAlCBlaXRoZXIgdGhlXG4gICAgLy8gcHVibGljYXRpb24gc3VjY2VlZHMsIHRoZSBkZWFkbGluZSBlbGFwc2VzLCBvciBhbiB1bmV4cGVjdGVkIGVycm9yIGlzXG4gICAgLy8gcmUtdGhyb3duLlxuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICBpZiAoYXdhaXQgdGhpcy50cnlBY3F1aXJlKG5hbWUpKSByZXR1cm4gdHJ1ZVxuXG4gICAgICBpZiAoZGVhZGxpbmUgIT09IG51bGwpIHtcbiAgICAgICAgY29uc3QgcmVtYWluaW5nID0gZGVhZGxpbmUgLSBEYXRlLm5vdygpXG5cbiAgICAgICAgaWYgKHJlbWFpbmluZyA8PSAwKSByZXR1cm4gZmFsc2VcblxuICAgICAgICBhd2FpdCB3YWl0KE1hdGgubWluKHRoaXMucG9sbEludGVydmFsTXMsIHJlbWFpbmluZykpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhd2FpdCB3YWl0KHRoaXMucG9sbEludGVydmFsTXMpXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEF0dGVtcHRzIHRvIGFjcXVpcmUgdGhlIG5hbWVkIGxvY2sgd2l0aG91dCB3YWl0aW5nLCByZWNsYWltaW5nIGEgc3RhbGVcbiAgICogbG9jayBkaXJlY3Rvcnkgd2hlbiBvbmUgaXMgZm91bmQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBUcnVlIHdoZW4gdGhpcyBiYWNrZW5kIGJlY2FtZSB0aGUgbG9jayBvd25lci5cbiAgICovXG4gIGFzeW5jIHRyeUFjcXVpcmUobmFtZSkge1xuICAgIGlmICh0aGlzLmhvbGRzQnlOYW1lLmhhcyhuYW1lKSkgcmV0dXJuIGZhbHNlXG5cbiAgICBhd2FpdCB0aGlzLmVuc3VyZURpcmVjdG9yeSgpXG5cbiAgICBjb25zdCBsb2NrUGF0aCA9IHRoaXMubG9ja1BhdGhGb3IobmFtZSlcblxuICAgIGlmIChhd2FpdCB0aGlzLnB1Ymxpc2hMb2NrRGlyZWN0b3J5KGxvY2tQYXRoKSkgcmV0dXJuIHRoaXMuc3RhcnRIb2xkKG5hbWUpXG5cbiAgICBpZiAoYXdhaXQgdGhpcy5pc1N0YWxlKGxvY2tQYXRoKSkge1xuICAgICAgYXdhaXQgZnMucm0obG9ja1BhdGgsIHtyZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlfSlcblxuICAgICAgaWYgKGF3YWl0IHRoaXMucHVibGlzaExvY2tEaXJlY3RvcnkobG9ja1BhdGgpKSByZXR1cm4gdGhpcy5zdGFydEhvbGQobmFtZSlcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxlYXNlcyB0aGUgbG9jayBvbmx5IHdoZW4gdGhpcyBiYWNrZW5kIGluc3RhbmNlIG93bnMgaXQsIG1pcnJvcmluZyB0aGVcbiAgICogXCJ5b3UgY2FuIG9ubHkgcmVsZWFzZSBsb2NrcyB5b3Ugb3duXCIgY29udHJhY3Qgb2YgdGhlIGRhdGFiYXNlIHRpZXJzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gVHJ1ZSB3aGVuIHRoZSBoZWxkIGxvY2sgd2FzIHJlbGVhc2VkLlxuICAgKi9cbiAgYXN5bmMgcmVsZWFzZShuYW1lKSB7XG4gICAgY29uc3QgaG9sZCA9IHRoaXMuaG9sZHNCeU5hbWUuZ2V0KG5hbWUpXG5cbiAgICBpZiAoIWhvbGQpIHJldHVybiBmYWxzZVxuXG4gICAgdGhpcy5jbGVhckhvbGQobmFtZSlcblxuICAgIGNvbnN0IG93bmVyID0gYXdhaXQgdGhpcy5yZWFkT3duZXIodGhpcy5sb2NrUGF0aEZvcihuYW1lKSlcblxuICAgIGlmICghb3duZXIgfHwgb3duZXIuaG9sZGVySWQgIT09IHRoaXMuaG9sZGVySWQpIHJldHVybiBmYWxzZVxuXG4gICAgYXdhaXQgZnMucm0odGhpcy5sb2NrUGF0aEZvcihuYW1lKSwge3JlY3Vyc2l2ZTogdHJ1ZSwgZm9yY2U6IHRydWV9KVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIGhlbGQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBsb2NrIGlzIGN1cnJlbnRseSBoZWxkIGJ5IGEgbGl2ZSwgdW5leHBpcmVkIG93bmVyLlxuICAgKi9cbiAgYXN5bmMgaXNIZWxkKG5hbWUpIHtcbiAgICBjb25zdCBsb2NrUGF0aCA9IHRoaXMubG9ja1BhdGhGb3IobmFtZSlcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBmcy5zdGF0KGxvY2tQYXRoKVxuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuXG4gICAgcmV0dXJuICFhd2FpdCB0aGlzLmlzU3RhbGUobG9ja1BhdGgpXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgdGhlIGN1cnJlbnQgb3duZXIgbWV0YWRhdGEgZm9yIGRpYWdub3N0aWNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8QWR2aXNvcnlMb2NrRmlsZU93bmVyIHwgbnVsbD59IC0gUGFyc2VkIG93bmVyIG1ldGFkYXRhLCB3aGVuIGEgbG9jayBkaXJlY3RvcnkgZXhpc3RzLlxuICAgKi9cbiAgYXN5bmMgaG9sZGVySW5mbyhuYW1lKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucmVhZE93bmVyKHRoaXMubG9ja1BhdGhGb3IobmFtZSkpXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgZXZlcnkgbG9jayB0aGlzIGJhY2tlbmQgaW5zdGFuY2UgY3VycmVudGx5IGhvbGRzIChzaHV0ZG93biBwYXRoKS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgYmVzdC1lZmZvcnQgcmVsZWFzZSBvZiBhbGwgaG9sZHMuXG4gICAqL1xuICBhc3luYyByZWxlYXNlQWxsSGVsZCgpIHtcbiAgICBmb3IgKGNvbnN0IG5hbWUgb2YgWy4uLnRoaXMuaG9sZHNCeU5hbWUua2V5cygpXSkge1xuICAgICAgYXdhaXQgdGhpcy5yZWxlYXNlKG5hbWUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgdGhlIHBhcmVudCBsb2NrIGRpcmVjdG9yeSBleGlzdHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSBkaXJlY3RvcnkgZXhpc3RzLlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlRGlyZWN0b3J5KCkge1xuICAgIGF3YWl0IGZzLm1rZGlyKHRoaXMuZGlyZWN0b3J5LCB7cmVjdXJzaXZlOiB0cnVlfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBQdWJsaXNoZXMgYSBmdWxseSBpbml0aWFsaXplZCBsb2NrIGRpcmVjdG9yeSB3aXRoIG9uZSBhdG9taWMgcmVuYW1lIHNvXG4gICAqIGNvbmN1cnJlbnQgY2FuZGlkYXRlcyBjYW5ub3Qgb2JzZXJ2ZSBhIGhhbGYtd3JpdHRlbiBvd25lciByZWNvcmQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBsb2NrUGF0aCAtIFN0YWJsZSBsb2NrIGRpcmVjdG9yeSBwYXRoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoaXMgY2FuZGlkYXRlIGJlY2FtZSB0aGUgbG9jayBvd25lci5cbiAgICovXG4gIGFzeW5jIHB1Ymxpc2hMb2NrRGlyZWN0b3J5KGxvY2tQYXRoKSB7XG4gICAgY29uc3QgY2FuZGlkYXRlUGF0aCA9IGF3YWl0IGZzLm1rZHRlbXAoYCR7bG9ja1BhdGh9LnBlbmRpbmctYClcbiAgICBsZXQgcHVibGlzaGVkID0gZmFsc2VcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLndyaXRlT3duZXIoY2FuZGlkYXRlUGF0aClcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgZnMucmVuYW1lKGNhbmRpZGF0ZVBhdGgsIGxvY2tQYXRoKVxuICAgICAgICBwdWJsaXNoZWQgPSB0cnVlXG4gICAgICAgIHJldHVybiB0cnVlXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zdCBjb2RlID0gLyoqIEB0eXBlIHtFcnJvciAmIHtjb2RlPzogc3RyaW5nfX0gKi8gKGVycm9yKT8uY29kZVxuXG4gICAgICAgIGlmIChjb2RlID09PSBcIkVFWElTVFwiIHx8IGNvZGUgPT09IFwiRU5PVEVNUFRZXCIpIHJldHVybiBmYWxzZVxuICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAoIXB1Ymxpc2hlZCkgYXdhaXQgZnMucm0oY2FuZGlkYXRlUGF0aCwge3JlY3Vyc2l2ZTogdHJ1ZSwgZm9yY2U6IHRydWV9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTdGFydHMgbGVhc2UgcmVuZXdhbCBmb3IgYSBmcmVzaGx5IGFjcXVpcmVkIGhvbGQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7dHJ1ZX0gLSBBbHdheXMgdHJ1ZTsgdGhlIGhvbGQgaXMgbm93IHRyYWNrZWQuXG4gICAqL1xuICBzdGFydEhvbGQobmFtZSkge1xuICAgIGNvbnN0IHRpbWVyID0gc2V0SW50ZXJ2YWwoKCkgPT4ge1xuICAgICAgdm9pZCB0aGlzLnJlbmV3SG9sZChuYW1lKVxuICAgIH0sIHRoaXMucmVuZXdJbnRlcnZhbE1zKVxuXG4gICAgaWYgKHR5cGVvZiB0aW1lci51bnJlZiA9PT0gXCJmdW5jdGlvblwiKSB0aW1lci51bnJlZigpXG5cbiAgICB0aGlzLmhvbGRzQnlOYW1lLnNldChuYW1lLCB7dGltZXJ9KVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRlbmRzIHRoaXMgaW5zdGFuY2UncyBsZWFzZSBvbiBvbmUgaGVsZCBsb2NrOyBzdG9wcyByZW5ld2luZyB3aGVuIHRoZVxuICAgKiBkaXJlY3RvcnkgaXMgbm8gbG9uZ2VyIG91cnMgKHRoZSBsb2NrIHdhcyByZWNsYWltZWQpLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHJlbmV3YWwgYXR0ZW1wdC5cbiAgICovXG4gIGFzeW5jIHJlbmV3SG9sZChuYW1lKSB7XG4gICAgY29uc3QgaG9sZCA9IHRoaXMuaG9sZHNCeU5hbWUuZ2V0KG5hbWUpXG5cbiAgICBpZiAoIWhvbGQpIHJldHVyblxuXG4gICAgY29uc3Qgb3duZXIgPSBhd2FpdCB0aGlzLnJlYWRPd25lcih0aGlzLmxvY2tQYXRoRm9yKG5hbWUpKVxuXG4gICAgaWYgKCFvd25lciB8fCBvd25lci5ob2xkZXJJZCAhPT0gdGhpcy5ob2xkZXJJZCkge1xuICAgICAgdGhpcy5jbGVhckhvbGQobmFtZSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMud3JpdGVPd25lcih0aGlzLmxvY2tQYXRoRm9yKG5hbWUpKVxuICB9XG5cbiAgLyoqXG4gICAqIENsZWFycyB0aGUgcmVuZXdhbCB0aW1lciBmb3Igb25lIGhvbGQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGNsZWFySG9sZChuYW1lKSB7XG4gICAgY29uc3QgaG9sZCA9IHRoaXMuaG9sZHNCeU5hbWUuZ2V0KG5hbWUpXG5cbiAgICBpZiAoIWhvbGQpIHJldHVyblxuXG4gICAgY2xlYXJJbnRlcnZhbChob2xkLnRpbWVyKVxuICAgIHRoaXMuaG9sZHNCeU5hbWUuZGVsZXRlKG5hbWUpXG4gIH1cblxuICAvKipcbiAgICogV3JpdGVzIG93bmVyICsgbGVhc2UgbWV0YWRhdGEgaW50byBhIGxvY2sgZGlyZWN0b3J5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbG9ja0RpclBhdGggLSBMb2NrIGRpcmVjdG9yeSB0byB3cml0ZSBtZXRhZGF0YSBpbnRvLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBtZXRhZGF0YSBpcyB3cml0dGVuLlxuICAgKi9cbiAgYXN5bmMgd3JpdGVPd25lcihsb2NrRGlyUGF0aCkge1xuICAgIC8qKiBAdHlwZSB7QWR2aXNvcnlMb2NrRmlsZU93bmVyfSAqL1xuICAgIGNvbnN0IG93bmVyID0ge1xuICAgICAgYWNxdWlyZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgaG9sZGVySWQ6IHRoaXMuaG9sZGVySWQsXG4gICAgICBob3N0bmFtZTogb3MuaG9zdG5hbWUoKSxcbiAgICAgIGxlYXNlRXhwaXJlc0F0OiBuZXcgRGF0ZShEYXRlLm5vdygpICsgdGhpcy5sZWFzZU1zKS50b0lTT1N0cmluZygpLFxuICAgICAgcGlkOiBwcm9jZXNzLnBpZCxcbiAgICAgIC4uLnRoaXMuZXh0cmFPd25lckZpZWxkc1xuICAgIH1cblxuICAgIGF3YWl0IGZzLndyaXRlRmlsZShwYXRoLmpvaW4obG9ja0RpclBhdGgsIFwib3duZXIuanNvblwiKSwgSlNPTi5zdHJpbmdpZnkob3duZXIpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIG93bmVyIG1ldGFkYXRhIGZyb20gYSBsb2NrIGRpcmVjdG9yeS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGxvY2tQYXRoIC0gTG9jayBkaXJlY3RvcnkgcGF0aC5cbiAgICogQHJldHVybnMge1Byb21pc2U8QWR2aXNvcnlMb2NrRmlsZU93bmVyIHwgbnVsbD59IC0gUGFyc2VkIG93bmVyIG1ldGFkYXRhLCB3aGVuIHJlYWRhYmxlLlxuICAgKi9cbiAgYXN5bmMgcmVhZE93bmVyKGxvY2tQYXRoKSB7XG4gICAgLyoqIEB0eXBlIHtzdHJpbmd9ICovXG4gICAgbGV0IHJhd093bmVyXG5cbiAgICB0cnkge1xuICAgICAgcmF3T3duZXIgPSBhd2FpdCBmcy5yZWFkRmlsZShwYXRoLmpvaW4obG9ja1BhdGgsIFwib3duZXIuanNvblwiKSwgXCJ1dGY4XCIpXG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gbnVsbFxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gLyoqIEB0eXBlIHtBZHZpc29yeUxvY2tGaWxlT3duZXJ9ICovIChKU09OLnBhcnNlKHJhd093bmVyKSlcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEEgbG9jayBkaXJlY3RvcnkgaXMgc3RhbGUgd2hlbiBpdHMgbWV0YWRhdGEgaXMgdW5yZWFkYWJsZSwgaXRzIGxlYXNlIGhhc1xuICAgKiBleHBpcmVkLCBvciBpdHMgb3duZXIgaXMgYSBkZWFkIHByb2Nlc3Mgb24gdGhpcyBob3N0LiBDcm9zcy1ob3N0IG93bmVyc1xuICAgKiBhcmUgb25seSByZWNsYWltYWJsZSB2aWEgbGVhc2UgZXhwaXJ5IOKAlCBQSUQgcHJvYmluZyBpcyB1bnJlbGlhYmxlIGJleW9uZFxuICAgKiBvbmUgaG9zdCwgd2hpY2ggaXMgZXhhY3RseSB3aHkgdGhpcyB0aWVyIGlzIHRoZSBvcHQtaW4gc2luZ2xlLWhvc3QgbGFzdFxuICAgKiByZXNvcnQgKGRlc2lnbiDCpzQvwqc4KS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGxvY2tQYXRoIC0gTG9jayBkaXJlY3RvcnkgcGF0aC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgbG9jayBjYW4gYmUgcmVjbGFpbWVkLlxuICAgKi9cbiAgYXN5bmMgaXNTdGFsZShsb2NrUGF0aCkge1xuICAgIGNvbnN0IG93bmVyID0gYXdhaXQgdGhpcy5yZWFkT3duZXIobG9ja1BhdGgpXG5cbiAgICBpZiAoIW93bmVyIHx8IHR5cGVvZiBvd25lci5waWQgIT09IFwibnVtYmVyXCIpIHJldHVybiB0cnVlXG5cbiAgICBpZiAob3duZXIubGVhc2VFeHBpcmVzQXQgJiYgbmV3IERhdGUob3duZXIubGVhc2VFeHBpcmVzQXQpLmdldFRpbWUoKSA8PSBEYXRlLm5vdygpKSByZXR1cm4gdHJ1ZVxuXG4gICAgaWYgKG93bmVyLmhvc3RuYW1lICYmIG93bmVyLmhvc3RuYW1lICE9PSBvcy5ob3N0bmFtZSgpKSByZXR1cm4gZmFsc2VcblxuICAgIHRyeSB7XG4gICAgICAvLyBga2lsbChwaWQsIDApYCBpcyBhIG5vLW9wIHNpZ25hbCB0aGF0IGZhaWxzIHdpdGggRVNSQ0ggd2hlbiB0aGVcbiAgICAgIC8vIHByb2Nlc3MgaXMgZ29uZTsgcGVybWlzc2lvbiBlcnJvcnMgc3RpbGwgcHJvdmUgdGhlIHByb2Nlc3MgZXhpc3RzLlxuICAgICAgcHJvY2Vzcy5raWxsKG93bmVyLnBpZCwgMClcblxuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHJldHVybiAvKiogQHR5cGUge0Vycm9yICYge2NvZGU/OiBzdHJpbmd9fSAqLyAoZXJyb3IpLmNvZGUgPT09IFwiRVNSQ0hcIlxuICAgIH1cbiAgfVxufVxuIl19