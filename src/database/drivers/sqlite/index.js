// @ts-check

import {createHash} from "node:crypto"
import fs from "fs/promises"
import os from "node:os"
import path from "node:path"
import query from "./query.js"
import sqlite3 from "sqlite3"
import {open} from "sqlite"

import Base from "./base.js"
import fileExists from "../../../utils/file-exists.js"

export default class VelociousDatabaseDriversSqliteNode extends Base {
  /** @type {import("sqlite3").Database | undefined} */
  connection = undefined

  /** @type {string | undefined} */
  _advisoryLockDirectory = undefined

  async connect() {
    const args = this.getArgs()
    const databaseDir = `${this.getConfiguration().getDirectory()}/db`
    const databasePath = `${databaseDir}/${this.localStorageName()}.sqlite`

    if (!await fileExists(databaseDir)) {
      await fs.mkdir(databaseDir, {recursive: true})
    }

    if (args.reset) {
      await fs.unlink(databasePath)
    }

    this._advisoryLockDirectory = path.join(databaseDir, `${this.localStorageName()}.velocious-advisory-locks`)

    try {
      // @ts-expect-error
      this.connection = /** @type {import("sqlite3").Database} */ (await open({
        filename: databasePath,
        driver: sqlite3.Database
      }))
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Couldn't open database ${databasePath} because of ${error.constructor.name}: ${error.message}`, {cause: error})
      } else {
        throw new Error(`Couldn't open database ${databasePath} because of ${typeof error}: ${error}`, {cause: error})
      }
    }

    await this.registerVersion()
  }

  localStorageName() {
    const args = this.getArgs()

    if (!args.name) throw new Error("No name given for SQLite Node")

    return `VelociousDatabaseDriversSqlite---${args.name}`
  }

  async close() {
    await this.connection?.close()
    this.connection = undefined
  }

  /**
   * @param {string} sql - SQL string.
   * @returns {Promise<Record<string, any>[]>} - Resolves with the query actual.
   */
  async _queryActual(sql) {
    if (!this.connection) throw new Error("No connection")

    return await query(this.connection, sql)
  }

  /**
   * Layers a filesystem lock directory on top of the in-process waiter
   * queue so SQLite deployments with multiple Node processes writing to
   * the same database file see consistent advisory-lock mutual exclusion
   * across processes, not just within a single process.
   *
   * The in-process queue from the shared SQLite base class is still used
   * for the fast intra-process path (no polling, waiters wake each other
   * through the `Set<string>` + waiter queue); the filesystem lock is
   * only checked once the in-process queue has granted the caller, so
   * typical single-process traffic pays at most two `fs.mkdir` calls
   * (create and remove) per critical section.
   *
   * @param {string} name - Lock name.
   * @param {{timeoutMs?: number | null}} [args] - Optional timeout in milliseconds; `null`, `undefined`, or negative blocks forever.
   * @returns {Promise<boolean>}
   */
  async acquireAdvisoryLock(name, {timeoutMs} = {}) {
    const deadline = typeof timeoutMs === "number" && timeoutMs >= 0 ? Date.now() + timeoutMs : null
    const remainingForInProcess = deadline !== null ? Math.max(0, deadline - Date.now()) : null
    const inProcessAcquired = await super.acquireAdvisoryLock(name, {timeoutMs: remainingForInProcess})

    if (!inProcessAcquired) return false

    try {
      const remainingForFile = deadline !== null ? Math.max(0, deadline - Date.now()) : null
      const fileAcquired = await this._acquireAdvisoryLockFile(name, {timeoutMs: remainingForFile})

      if (!fileAcquired) {
        await super.releaseAdvisoryLock(name)
        return false
      }
    } catch (error) {
      await super.releaseAdvisoryLock(name)
      throw error
    }

    return true
  }

  /**
   * @param {string} name - Lock name.
   * @returns {Promise<boolean>}
   */
  async tryAcquireAdvisoryLock(name) {
    const inProcessAcquired = await super.tryAcquireAdvisoryLock(name)

    if (!inProcessAcquired) return false

    try {
      const fileAcquired = await this._tryAcquireAdvisoryLockFile(name)

      if (!fileAcquired) {
        await super.releaseAdvisoryLock(name)
        return false
      }
    } catch (error) {
      await super.releaseAdvisoryLock(name)
      throw error
    }

    return true
  }

  /**
   * @param {string} name - Lock name.
   * @returns {Promise<boolean>}
   */
  async releaseAdvisoryLock(name) {
    try {
      await this._releaseAdvisoryLockFile(name)
    } finally {
      await super.releaseAdvisoryLock(name)
    }

    return true
  }

  /**
   * @param {string} name - Lock name.
   * @returns {Promise<boolean>}
   */
  async isAdvisoryLockHeld(name) {
    if (await super.isAdvisoryLockHeld(name)) return true

    return await this._isAdvisoryLockFileHeld(name)
  }

  /** @returns {string} */
  _resolveAdvisoryLockDirectory() {
    if (!this._advisoryLockDirectory) {
      // Fall back to deriving the directory for callers that invoked
      // advisory lock methods before `connect()` wired the field in.
      const databaseDir = `${this.getConfiguration().getDirectory()}/db`

      this._advisoryLockDirectory = path.join(databaseDir, `${this.localStorageName()}.velocious-advisory-locks`)
    }

    return this._advisoryLockDirectory
  }

  /**
   * @param {string} name - Lock name.
   * @returns {string}
   */
  _advisoryLockPath(name) {
    const hash = createHash("sha256").update(name).digest("hex").slice(0, 16)
    const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64)

    return path.join(this._resolveAdvisoryLockDirectory(), `${safeName}-${hash}.lock`)
  }

  /** @returns {Promise<void>} */
  async _ensureAdvisoryLockDirectory() {
    await fs.mkdir(this._resolveAdvisoryLockDirectory(), {recursive: true})
  }

  /**
   * @param {string} lockDirPath - Absolute path of the lock directory.
   * @returns {Promise<void>}
   */
  async _writeAdvisoryLockMetadata(lockDirPath) {
    const ownerPath = path.join(lockDirPath, "owner.json")
    const payload = JSON.stringify({
      pid: process.pid,
      hostname: os.hostname(),
      acquiredAt: new Date().toISOString()
    })

    await fs.writeFile(ownerPath, payload)
  }

  /**
   * @param {string} name - Lock name.
   * @param {{timeoutMs?: number | null}} args - Timeout args.
   * @returns {Promise<boolean>}
   */
  async _acquireAdvisoryLockFile(name, {timeoutMs}) {
    await this._ensureAdvisoryLockDirectory()

    const lockPath = this._advisoryLockPath(name)
    const deadline = typeof timeoutMs === "number" && timeoutMs >= 0 ? Date.now() + timeoutMs : null
    const pollIntervalMs = 50

    // Intentionally looping without a fixed iteration cap — either the
    // mkdir succeeds, the deadline elapses, or an unexpected error is
    // re-thrown.
    while (true) {
      try {
        await fs.mkdir(lockPath)
        await this._writeAdvisoryLockMetadata(lockPath)

        return true
      } catch (error) {
        if (/** @type {NodeJS.ErrnoException} */ (error)?.code !== "EEXIST") throw error

        if (await this._isAdvisoryLockStale(lockPath)) {
          await fs.rm(lockPath, {recursive: true, force: true})
          continue
        }

        if (deadline !== null) {
          const remaining = deadline - Date.now()

          if (remaining <= 0) return false

          await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, remaining)))
        } else {
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
        }
      }
    }
  }

  /**
   * @param {string} name - Lock name.
   * @returns {Promise<boolean>}
   */
  async _tryAcquireAdvisoryLockFile(name) {
    await this._ensureAdvisoryLockDirectory()

    const lockPath = this._advisoryLockPath(name)

    try {
      await fs.mkdir(lockPath)
      await this._writeAdvisoryLockMetadata(lockPath)

      return true
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error)?.code !== "EEXIST") throw error

      if (await this._isAdvisoryLockStale(lockPath)) {
        await fs.rm(lockPath, {recursive: true, force: true})

        try {
          await fs.mkdir(lockPath)
          await this._writeAdvisoryLockMetadata(lockPath)

          return true
        } catch (retryError) {
          if (/** @type {NodeJS.ErrnoException} */ (retryError)?.code === "EEXIST") return false

          throw retryError
        }
      }

      return false
    }
  }

  /**
   * @param {string} name - Lock name.
   * @returns {Promise<void>}
   */
  async _releaseAdvisoryLockFile(name) {
    const lockPath = this._advisoryLockPath(name)

    try {
      await fs.rm(lockPath, {recursive: true, force: true})
    } catch {
      // Best-effort release; in-process state is still authoritative and
      // stale-lock cleanup on the next acquire will remove the directory
      // if it really is still lingering.
    }
  }

  /**
   * @param {string} name - Lock name.
   * @returns {Promise<boolean>}
   */
  async _isAdvisoryLockFileHeld(name) {
    const lockPath = this._advisoryLockPath(name)

    try {
      await fs.stat(lockPath)
    } catch {
      return false
    }

    return !await this._isAdvisoryLockStale(lockPath)
  }

  /**
   * A lock directory is considered stale when its owner metadata names a
   * PID on this host that is no longer running. Cross-host ownership (a
   * different `hostname`) is treated as live because we cannot reliably
   * probe a PID on another machine; operators in that situation should
   * remove stale lock directories by hand if they linger.
   *
   * @param {string} lockPath - Absolute path of the lock directory.
   * @returns {Promise<boolean>}
   */
  async _isAdvisoryLockStale(lockPath) {
    /** @type {string} */
    let rawOwner

    try {
      rawOwner = await fs.readFile(path.join(lockPath, "owner.json"), "utf8")
    } catch {
      // Missing or unreadable metadata — treat as stale so we can reclaim.
      return true
    }

    /** @type {{pid?: number, hostname?: string}} */
    let owner

    try {
      owner = JSON.parse(rawOwner)
    } catch {
      return true
    }

    if (!owner || typeof owner.pid !== "number") return true
    if (owner.hostname && owner.hostname !== os.hostname()) return false

    try {
      // `kill(pid, 0)` is a no-op signal that fails with ESRCH if the
      // process is not running; permission errors still indicate the
      // process exists so we treat those as "not stale".
      process.kill(owner.pid, 0)

      return false
    } catch (error) {
      return /** @type {NodeJS.ErrnoException} */ (error)?.code === "ESRCH"
    }
  }
}
