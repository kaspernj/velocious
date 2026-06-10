// @ts-check

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

/**
 * Directory-based lock that allows only one HTTP server process per app directory.
 */
export default class VelociousHttpServerLock {
  /**
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

  /** @returns {Promise<void>} - Resolves after the lock has been acquired. */
  async acquire() {
    await fs.mkdir(path.dirname(this.lockPath), {recursive: true})

    while (true) {
      try {
        await fs.mkdir(this.lockPath)

        try {
          await this.writeOwnerMetadata()
        } catch (error) {
          await fs.rm(this.lockPath, {recursive: true, force: true})

          throw error
        }

        this.acquired = true
        return
      } catch (error) {
        if (/** @type {NodeJS.ErrnoException} */ (error).code !== "EEXIST") throw error

        if (await this.isStale()) {
          await fs.rm(this.lockPath, {recursive: true, force: true})
          continue
        }

        throw new Error(await this.lockHeldMessage(), {cause: error})
      }
    }
  }

  /** @returns {Promise<void>} - Resolves after best-effort lock release. */
  async release() {
    if (!this.acquired) return

    this.acquired = false
    await fs.rm(this.lockPath, {recursive: true, force: true})
  }

  /** @returns {Promise<void>} - Resolves after owner metadata has been written. */
  async writeOwnerMetadata() {
    await fs.writeFile(path.join(this.lockPath, "owner.json"), JSON.stringify({
      acquiredAt: new Date().toISOString(),
      host: this.host,
      hostname: os.hostname(),
      pid: process.pid,
      port: this.port
    }))
  }

  /** @returns {Promise<boolean>} - Whether the existing lock belongs to a dead process. */
  async isStale() {
    const owner = await this.readOwnerMetadata()

    if (!owner || typeof owner.pid !== "number") return false
    if (owner.hostname && owner.hostname !== os.hostname()) return false

    try {
      process.kill(owner.pid, 0)

      return false
    } catch (error) {
      return /** @type {NodeJS.ErrnoException} */ (error).code === "ESRCH"
    }
  }

  /** @returns {Promise<Record<string, unknown> | null>} - Parsed owner metadata, when readable. */
  async readOwnerMetadata() {
    try {
      const rawOwner = await fs.readFile(path.join(this.lockPath, "owner.json"), "utf8")

      return /** @type {Record<string, unknown>} */ (JSON.parse(rawOwner))
    } catch {
      return null
    }
  }

  /** @returns {Promise<string>} - Error message explaining which server owns the lock. */
  async lockHeldMessage() {
    const owner = await this.readOwnerMetadata()
    const details = owner
      ? `PID ${String(owner.pid)} on ${String(owner.hostname)} (${String(owner.host)}:${String(owner.port)})`
      : `lock directory ${this.lockPath}`

    return `A Velocious HTTP server is already running for this application (${details}). Remove ${this.lockPath} if the server is no longer running.`
  }
}
