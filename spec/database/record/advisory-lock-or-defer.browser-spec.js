// @ts-check

import Configuration from "../../../src/configuration.js"
import Task from "../../dummy/src/models/task.js"

/**
 * Holds the lock from a sibling driver instance: named locks are session-
 * scoped and re-entrant within a session, so cross-session contention needs a
 * second physical connection (same helper shape as
 * `advisory-locks.browser-spec.js`).
 * @template T
 * @param {(driver: import("../../../src/database/drivers/base.js").default) => Promise<T>} callback - Body receiving the holder driver.
 * @returns {Promise<T>} - Body result.
 */
async function withSecondConnection(callback) {
  const pool = Configuration.current().getDatabasePool()
  const driver = await pool.spawnConnection()
  const sharesConnection = Boolean(driver.getArgs()?.getConnection)

  try {
    return await callback(driver)
  } finally {
    if (!sharesConnection) {
      if (typeof driver.close === "function") {
        await driver.close()
      } else if (typeof driver.disconnect === "function") {
        await driver.disconnect()
      }
    }
  }
}

describe("Record - advisory lock or defer", {tags: ["dummy"]}, () => {
  it("runs the callback and returns the held result when the lock is free", async () => {
    await Configuration.current().ensureConnections(async () => {
      const lockName = "velocious-advisory-defer-free"

      const outcome = await Task.withAdvisoryLockOrDefer(lockName, async () => "callback-value")

      expect(outcome).toEqual({acquired: true, result: "callback-value"})
      expect(await Task.hasAdvisoryLock(lockName)).toBe(false)
    })
  })

  it("returns the contended defer result without throwing when another session holds the lock", async () => {
    await Configuration.current().ensureConnections(async () => {
      const lockName = "velocious-advisory-defer-busy"

      await withSecondConnection(async (blocker) => {
        expect(await blocker.tryAcquireAdvisoryLock(lockName)).toBe(true)

        try {
          const outcome = await Task.withAdvisoryLockOrDefer(lockName, async () => {
            throw new Error("Callback must not run when the lock is held by another session")
          })

          expect(outcome).toEqual({acquired: false, reason: "contended", lockName})
        } finally {
          await blocker.releaseAdvisoryLock(lockName)
        }
      })

      expect(await Task.hasAdvisoryLock(lockName)).toBe(false)
    })
  })
})
