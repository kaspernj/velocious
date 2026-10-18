// @ts-check

import {createHash} from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import wait from "awaitery/build/wait.js"

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
  constructor({directory, extraOwnerFields = {}, leaseMs = 30_000, renewIntervalMs = 10_000, pathStyle = "hashed", pollIntervalMs = 50}) {
    this.directory = directory
    this.extraOwnerFields = extraOwnerFields
    this.leaseMs = leaseMs
    this.renewIntervalMs = renewIntervalMs
    this.pathStyle = pathStyle
    this.pollIntervalMs = pollIntervalMs
    this.holderId = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    /** @type {Map<string, {timer: ReturnType<typeof setInterval>}>} */
    this.holdsByName = new Map()
  }

  /**
   * Resolves the stable lock directory path for one lock name.
   * @param {string} name - Lock name.
   * @returns {string} - Filesystem path for the lock directory.
   */
  lockPathFor(name) {
    if (this.pathStyle === "plain") return path.join(this.directory, `${name}.lock`)

    const hash = createHash("sha256").update(name).digest("hex").slice(0, 16)
    const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64)

    return path.join(this.directory, `${safeName}-${hash}.lock`)
  }

  /**
   * Blocks until the named lock is acquired or `timeoutMs` elapses.
   * @param {string} name - Lock name.
   * @param {{timeoutMs?: number | null}} [args] - Timeout args; `null`, `undefined`, or negative waits indefinitely.
   * @returns {Promise<boolean>} - True when acquired, false when the timeout elapsed.
   */
  async acquire(name, {timeoutMs} = {}) {
    const deadline = typeof timeoutMs === "number" && timeoutMs >= 0 ? Date.now() + timeoutMs : null

    await this.ensureDirectory()

    // Intentionally looping without a fixed iteration cap — either the
    // publication succeeds, the deadline elapses, or an unexpected error is
    // re-thrown.
    while (true) {
      if (await this.tryAcquire(name)) return true

      if (deadline !== null) {
        const remaining = deadline - Date.now()

        if (remaining <= 0) return false

        await wait(Math.min(this.pollIntervalMs, remaining))
      } else {
        await wait(this.pollIntervalMs)
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
    if (this.holdsByName.has(name)) return false

    await this.ensureDirectory()

    const lockPath = this.lockPathFor(name)

    if (await this.publishLockDirectory(lockPath)) return this.startHold(name)

    if (await this.isStale(lockPath)) {
      await fs.rm(lockPath, {recursive: true, force: true})

      if (await this.publishLockDirectory(lockPath)) return this.startHold(name)
    }

    return false
  }

  /**
   * Releases the lock only when this backend instance owns it, mirroring the
   * "you can only release locks you own" contract of the database tiers.
   * @param {string} name - Lock name.
   * @returns {Promise<boolean>} - True when the held lock was released.
   */
  async release(name) {
    const hold = this.holdsByName.get(name)

    if (!hold) return false

    this.clearHold(name)

    const owner = await this.readOwner(this.lockPathFor(name))

    if (!owner || owner.holderId !== this.holderId) return false

    await fs.rm(this.lockPathFor(name), {recursive: true, force: true})

    return true
  }

  /**
   * Runs is held.
   * @param {string} name - Lock name.
   * @returns {Promise<boolean>} - Whether the lock is currently held by a live, unexpired owner.
   */
  async isHeld(name) {
    const lockPath = this.lockPathFor(name)

    try {
      await fs.stat(lockPath)
    } catch {
      return false
    }

    return !await this.isStale(lockPath)
  }

  /**
   * Reads the current owner metadata for diagnostics.
   * @param {string} name - Lock name.
   * @returns {Promise<AdvisoryLockFileOwner | null>} - Parsed owner metadata, when a lock directory exists.
   */
  async holderInfo(name) {
    return await this.readOwner(this.lockPathFor(name))
  }

  /**
   * Releases every lock this backend instance currently holds (shutdown path).
   * @returns {Promise<void>} - Resolves after best-effort release of all holds.
   */
  async releaseAllHeld() {
    for (const name of [...this.holdsByName.keys()]) {
      await this.release(name)
    }
  }

  /**
   * Ensures the parent lock directory exists.
   * @returns {Promise<void>} - Resolves after the directory exists.
   */
  async ensureDirectory() {
    await fs.mkdir(this.directory, {recursive: true})
  }

  /**
   * Publishes a fully initialized lock directory with one atomic rename so
   * concurrent candidates cannot observe a half-written owner record.
   * @param {string} lockPath - Stable lock directory path.
   * @returns {Promise<boolean>} - Whether this candidate became the lock owner.
   */
  async publishLockDirectory(lockPath) {
    const candidatePath = await fs.mkdtemp(`${lockPath}.pending-`)
    let published = false

    try {
      await this.writeOwner(candidatePath)

      try {
        await fs.rename(candidatePath, lockPath)
        published = true
        return true
      } catch (error) {
        const code = /** @type {Error & {code?: string}} */ (error)?.code

        if (code === "EEXIST" || code === "ENOTEMPTY") return false
        throw error
      }
    } finally {
      if (!published) await fs.rm(candidatePath, {recursive: true, force: true})
    }
  }

  /**
   * Starts lease renewal for a freshly acquired hold.
   * @param {string} name - Lock name.
   * @returns {true} - Always true; the hold is now tracked.
   */
  startHold(name) {
    const timer = setInterval(() => {
      void this.renewHold(name)
    }, this.renewIntervalMs)

    if (typeof timer.unref === "function") timer.unref()

    this.holdsByName.set(name, {timer})

    return true
  }

  /**
   * Extends this instance's lease on one held lock; stops renewing when the
   * directory is no longer ours (the lock was reclaimed).
   * @param {string} name - Lock name.
   * @returns {Promise<void>} - Resolves after the renewal attempt.
   */
  async renewHold(name) {
    const hold = this.holdsByName.get(name)

    if (!hold) return

    const owner = await this.readOwner(this.lockPathFor(name))

    if (!owner || owner.holderId !== this.holderId) {
      this.clearHold(name)
      return
    }

    await this.writeOwner(this.lockPathFor(name))
  }

  /**
   * Clears the renewal timer for one hold.
   * @param {string} name - Lock name.
   * @returns {void}
   */
  clearHold(name) {
    const hold = this.holdsByName.get(name)

    if (!hold) return

    clearInterval(hold.timer)
    this.holdsByName.delete(name)
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
    }

    await fs.writeFile(path.join(lockDirPath, "owner.json"), JSON.stringify(owner))
  }

  /**
   * Reads owner metadata from a lock directory.
   * @param {string} lockPath - Lock directory path.
   * @returns {Promise<AdvisoryLockFileOwner | null>} - Parsed owner metadata, when readable.
   */
  async readOwner(lockPath) {
    /** @type {string} */
    let rawOwner

    try {
      rawOwner = await fs.readFile(path.join(lockPath, "owner.json"), "utf8")
    } catch {
      return null
    }

    try {
      return /** @type {AdvisoryLockFileOwner} */ (JSON.parse(rawOwner))
    } catch {
      return null
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
    const owner = await this.readOwner(lockPath)

    if (!owner || typeof owner.pid !== "number") return true

    if (owner.leaseExpiresAt && new Date(owner.leaseExpiresAt).getTime() <= Date.now()) return true

    if (owner.hostname && owner.hostname !== os.hostname()) return false

    try {
      // `kill(pid, 0)` is a no-op signal that fails with ESRCH when the
      // process is gone; permission errors still prove the process exists.
      process.kill(owner.pid, 0)

      return false
    } catch (error) {
      return /** @type {Error & {code?: string}} */ (error).code === "ESRCH"
    }
  }
}
