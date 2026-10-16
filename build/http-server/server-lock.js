// @ts-check

import AdvisoryLockFileBackend from "../database/advisory-lock-file-backend.js"
import path from "node:path"

/**
 * Directory-based lock that allows only one HTTP server process per app
 * directory. Thin wrapper over the shared file-lock backend
 * (`src/database/advisory-lock-file-backend.js` — the STC-210 `file` tier
 * primitive generalized from this lock's original hand-rolled directory
 * protocol), so the server lock and the advisory-lock file tier share one
 * acquisition, owner-metadata, lease-renewal, and staleness implementation.
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
    this.backend = new AdvisoryLockFileBackend({
      directory: path.join(configuration.getDirectory(), "tmp"),
      extraOwnerFields: {host: this.host, port: this.port},
      pathStyle: "plain"
    })
    this.acquired = false
  }

  /**
   * Acquires the app-directory HTTP server lock before startup side effects
   * run. A stale lock (dead local owner or expired lease) is reclaimed by the
   * backend; a live foreign owner fails loudly with the owner details.
   * @returns {Promise<void>} - Resolves after the lock has been acquired.
   */
  async acquire() {
    const acquired = await this.backend.acquire("server", {timeoutMs: 0})

    if (!acquired) throw new Error(await this.lockHeldMessage())

    this.acquired = true
  }

  /**
   * Releases the held HTTP server lock directory.
   * @returns {Promise<void>} - Resolves after best-effort lock release.
   */
  async release() {
    if (!this.acquired) return

    this.acquired = false
    await this.backend.release("server")
  }

  /**
   * Reads owner metadata from an existing server lock directory.
   * @returns {Promise<import("../database/advisory-lock-file-backend.js").AdvisoryLockFileOwner | null>} - Parsed owner metadata, when readable.
   */
  async readOwnerMetadata() {
    return await this.backend.holderInfo("server")
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
