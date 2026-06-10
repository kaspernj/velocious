// @ts-check

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

/**
 * Directory-based lock that allows only one HTTP server process per app directory.
 */
export default class VelociousHttpServerLock {
  /**
   * Build a lock for the configured application directory and server endpoint.
   * @param {object} args - Options object.
   * @param {import("../configuration.js").default} args.configuration - Configuration that owns the application directory.
   * @param {string} args.host - Configured HTTP host.
   * @param {number} args.port - Configured HTTP port.
   */
  constructor({configuration, host, port}) {
    this.configuration = configuration
    this.host = host
    this.port = port
    this.lockPath = path.join(configuration.getDirectory(), "tmp", "server.lock")
    this.acquired = false
  }

  /**
   * Acquires the app-directory HTTP server lock before startup side effects run.
   * @returns {Promise<void>} - Resolves after the lock has been acquired.
   */
  async acquire() {
    await fs.mkdir(path.dirname(this.lockPath), {recursive: true})

    while (true) {
      const acquired = await this.tryAcquire()

      if (acquired) {
        return
      }

      if (await this.isStale()) {
        await fs.rm(this.lockPath, {recursive: true, force: true})
        continue
      }

      throw new Error(await this.lockHeldMessage())
    }
  }

  /**
   * Tries to create the lock directory and write owner metadata.
   * @returns {Promise<boolean>} - Whether the lock was acquired.
   */
  async tryAcquire() {
    try {
      await fs.mkdir(this.lockPath)
    } catch (error) {
      if (/**
           * Narrows the runtime value to the documented type.
            @type {{code?: string}} */ (error).code === "EEXIST") return false
      throw error
    }

    try {
      await this.writeOwnerMetadata()
      this.acquired = true

      return true
    } catch (error) {
      await fs.rm(this.lockPath, {recursive: true, force: true})
      throw error
    }
  }

  /**
   * Releases the held HTTP server lock directory.
   * @returns {Promise<void>} - Resolves after best-effort lock release.
   */
  async release() {
    if (!this.acquired) return

    this.acquired = false
    await fs.rm(this.lockPath, {recursive: true, force: true})
  }

  /**
   * Writes metadata used to explain or reclaim an existing server lock.
   * @returns {Promise<void>} - Resolves after owner metadata has been written.
   */
  async writeOwnerMetadata() {
    await fs.writeFile(path.join(this.lockPath, "owner.json"), JSON.stringify({
      acquiredAt: new Date().toISOString(),
      host: this.host,
      hostname: os.hostname(),
      pid: process.pid,
      port: this.port
    }))
  }

  /**
   * Checks whether the current lock owner is a dead process on this host.
   * @returns {Promise<boolean>} - Whether the existing lock belongs to a dead process.
   */
  async isStale() {
    const owner = await this.readOwnerMetadata()

    if (!this.isLocalProcessOwner(owner)) return false

    return this.processIsDead(/**
                               * Narrows the runtime value to the documented type.
                                @type {{pid: number}} */ (owner).pid)
  }

  /**
   * Runs is local process owner.
   * @param {Record<string, ?> | null} owner - Existing lock owner metadata.
   * @returns {boolean} - Whether owner metadata names a local process.
   */
  isLocalProcessOwner(owner) {
    if (!owner) return false
    if (typeof owner.pid !== "number") return false

    return this.ownerHostnameMatches(owner)
  }

  /**
   * Runs owner hostname matches.
   * @param {Record<string, ?>} owner - Existing lock owner metadata.
   * @returns {boolean} - Whether the owner hostname is local or absent.
   */
  ownerHostnameMatches(owner) {
    if (!owner.hostname) return true
    if (owner.hostname === os.hostname()) return true

    return false
  }

  /**
   * Runs process is dead.
   * @param {number} pid - Process id.
   * @returns {boolean} - Whether the process no longer exists.
   */
  processIsDead(pid) {
    try {
      process.kill(pid, 0)

      return false
    } catch (error) {
      return /** Narrows the runtime value to the documented type. @type {{code?: string}} */ (error).code === "ESRCH"
    }
  }

  /**
   * Reads owner metadata from an existing server lock directory.
   * @returns {Promise<Record<string, ?> | null>} - Parsed owner metadata, when readable.
   */
  async readOwnerMetadata() {
    try {
      const rawOwner = await fs.readFile(path.join(this.lockPath, "owner.json"), "utf8")

      return /** Narrows the runtime value to the documented type. @type {Record<string, ?>} */ (JSON.parse(rawOwner))
    } catch {
      return null
    }
  }

  /**
   * Builds a duplicate-server error message with owner details when available.
   * @returns {Promise<string>} - Error message explaining which server owns the lock.
   */
  async lockHeldMessage() {
    const owner = await this.readOwnerMetadata()
    const details = owner
      ? `PID ${String(owner.pid)} on ${String(owner.hostname)} (${String(owner.host)}:${String(owner.port)})`
      : `lock directory ${this.lockPath}`

    return `A Velocious HTTP server is already running for this application (${details}). Remove ${this.lockPath} if the server is no longer running.`
  }
}
