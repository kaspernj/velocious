// @ts-check

import {createHash} from "node:crypto"
import fs from "fs/promises"
import os from "node:os"
import path from "node:path"

import Configuration from "../../../../src/configuration.js"
import VelociousDatabaseDriversSqliteNode from "../../../../src/database/drivers/sqlite/index.js"
import Task from "../../../dummy/src/models/task.js"

/**
 * Computes the same lock directory path the driver uses, so the test
 * can poke at filesystem state without depending on private helpers.
 * @param {import("../../../../src/database/drivers/sqlite/index.js").default} driver
 * @returns {string}
 */
function lockDirectoryFor(driver) {
  // @ts-expect-error: accessing the private helper intentionally in test.
  return driver._resolveAdvisoryLockDirectory()
}

/**
 * @param {import("../../../../src/database/drivers/sqlite/index.js").default} driver
 * @param {string} name
 * @returns {string}
 */
function lockPathFor(driver, name) {
  const hash = createHash("sha256").update(name).digest("hex").slice(0, 16)
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64)

  return path.join(lockDirectoryFor(driver), `${safeName}-${hash}.lock`)
}

describe("Record - advisory locks - Node SQLite file lock", {tags: ["dummy"]}, () => {
  it("is only exercised against the Node SQLite driver", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      expect(dbs.default).toBeInstanceOf(VelociousDatabaseDriversSqliteNode)
    })
  })

  it("writes and removes an on-disk lock directory around withAdvisoryLock", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const driver = /** @type {VelociousDatabaseDriversSqliteNode} */ (dbs.default)
      const lockName = "velocious-node-file-lock-happy"
      const lockPath = lockPathFor(driver, lockName)

      let ownerMetadata

      await Task.withAdvisoryLock(lockName, async () => {
        const stat = await fs.stat(lockPath)

        expect(stat.isDirectory()).toBe(true)

        const ownerRaw = await fs.readFile(path.join(lockPath, "owner.json"), "utf8")
        ownerMetadata = JSON.parse(ownerRaw)
      })

      expect(ownerMetadata?.pid).toBe(process.pid)
      expect(ownerMetadata?.hostname).toBe(os.hostname())

      /** @type {boolean} */
      let lockDirStillThere

      try {
        await fs.stat(lockPath)
        lockDirStillThere = true
      } catch {
        lockDirStillThere = false
      }

      expect(lockDirStillThere).toBe(false)
    })
  })

  it("reclaims a stale lock directory left behind by a dead PID", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const driver = /** @type {VelociousDatabaseDriversSqliteNode} */ (dbs.default)
      const lockName = "velocious-node-file-lock-stale"
      const lockPath = lockPathFor(driver, lockName)

      // Manually create a stale lock directory owned by a PID that is
      // extremely unlikely to exist. `process.kill(pid, 0)` returns
      // `ESRCH` for unused PIDs on this host, which the driver uses to
      // detect and reclaim stale locks.
      await fs.mkdir(lockDirectoryFor(driver), {recursive: true})
      await fs.mkdir(lockPath, {recursive: true})
      await fs.writeFile(path.join(lockPath, "owner.json"), JSON.stringify({
        pid: 2_147_483_647,
        hostname: os.hostname(),
        acquiredAt: new Date(0).toISOString()
      }))

      const acquired = await Task.withAdvisoryLock(lockName, async () => "reclaimed")

      expect(acquired).toBe("reclaimed")

      /** @type {boolean} */
      let lockDirStillThere

      try {
        await fs.stat(lockPath)
        lockDirStillThere = true
      } catch {
        lockDirStillThere = false
      }

      expect(lockDirStillThere).toBe(false)
    })
  })

  it("refuses tryAcquireAdvisoryLock while a live lock file is present", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const driver = /** @type {VelociousDatabaseDriversSqliteNode} */ (dbs.default)
      const lockName = "velocious-node-file-lock-live"
      const lockPath = lockPathFor(driver, lockName)

      // Create a live-looking lock owned by this process so the stale
      // detector treats it as held. We don't go through the ORM here
      // because we want to simulate the on-disk state that would be
      // produced by a second Node process holding the same lock.
      await fs.mkdir(lockDirectoryFor(driver), {recursive: true})
      await fs.mkdir(lockPath, {recursive: true})
      await fs.writeFile(path.join(lockPath, "owner.json"), JSON.stringify({
        pid: process.pid,
        hostname: os.hostname(),
        acquiredAt: new Date().toISOString()
      }))

      try {
        const acquired = await driver.tryAcquireAdvisoryLock(lockName)

        expect(acquired).toBe(false)
        expect(await driver.isAdvisoryLockHeld(lockName)).toBe(true)
      } finally {
        await fs.rm(lockPath, {recursive: true, force: true})
      }

      expect(await driver.isAdvisoryLockHeld(lockName)).toBe(false)
    })
  })

  it("refuses releaseAdvisoryLock from a driver instance that does not own the lock", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const ownerDriver = /** @type {VelociousDatabaseDriversSqliteNode} */ (dbs.default)
      const lockName = "velocious-node-file-lock-ownership"
      const lockPath = lockPathFor(ownerDriver, lockName)

      // Build a sibling driver instance that shares the process-wide
      // in-memory state and the same on-disk lock directory. It does
      // not need its own SQLite connection — the advisory lock methods
      // on the Node driver only touch the in-memory owner table and
      // the lock directory, both of which are keyed off the
      // configuration directory + database name.
      const siblingDriver = new VelociousDatabaseDriversSqliteNode(ownerDriver.getArgs(), ownerDriver.getConfiguration())
      // @ts-expect-error: populating the private field to match the
      // configured path the owner driver computed in connect().
      siblingDriver._advisoryLockDirectory = ownerDriver._resolveAdvisoryLockDirectory()

      const acquired = await ownerDriver.tryAcquireAdvisoryLock(lockName)

      expect(acquired).toBe(true)

      try {
        // Sibling does not own the lock — release must be a no-op
        // that returns false and leaves the on-disk directory alone.
        const siblingReleased = await siblingDriver.releaseAdvisoryLock(lockName)

        expect(siblingReleased).toBe(false)
        expect(await ownerDriver.isAdvisoryLockHeld(lockName)).toBe(true)

        const stat = await fs.stat(lockPath)

        expect(stat.isDirectory()).toBe(true)
      } finally {
        // Real owner can still release.
        const ownerReleased = await ownerDriver.releaseAdvisoryLock(lockName)

        expect(ownerReleased).toBe(true)
      }

      expect(await ownerDriver.isAdvisoryLockHeld(lockName)).toBe(false)

      /** @type {boolean} */
      let lockDirStillThere

      try {
        await fs.stat(lockPath)
        lockDirStillThere = true
      } catch {
        lockDirStillThere = false
      }

      expect(lockDirStillThere).toBe(false)
    })
  })
})
