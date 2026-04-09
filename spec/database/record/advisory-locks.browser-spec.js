// @ts-check

import Configuration from "../../../src/configuration.js"
import Task from "../../dummy/src/models/task.js"
import {AdvisoryLockBusyError, AdvisoryLockTimeoutError} from "../../../src/database/record/index.js"

/**
 * Spawns a sibling driver instance from the default pool and runs the
 * callback with it as the lock holder. Each named-lock primitive on
 * MySQL/PostgreSQL/MSSQL is **session-scoped** and re-entrant within
 * the same session, so the only portable way to test cross-session
 * contention from a single test is to actually open a second physical
 * connection. The sibling driver is released in `finally`.
 *
 * The cleanup is intentionally driver-aware: when the test runner is
 * sharing a single sql.js Database via `args.getConnection` (the
 * browser test harness), the spawned driver does **not** own the
 * underlying connection — calling `close()` on it would tear down the
 * shared Database used by every other test. In that case the spawned
 * driver is just a state holder for the static in-process advisory
 * lock map and can be dropped on the floor. For real physical
 * connections (MySQL/PostgreSQL/MSSQL/Node SQLite) `close()` releases
 * the per-spawn resource that `spawnConnection` opened.
 *
 * @template T
 * @param {(driver: import("../../../src/database/drivers/base.js").default) => Promise<T>} callback
 * @returns {Promise<T>}
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

describe("Record - advisory locks", {tags: ["dummy"]}, () => {
  it("runs the callback under withAdvisoryLock and releases when it returns", async () => {
    await Configuration.current().ensureConnections(async () => {
      const lockName = "velocious-advisory-test-happy"
      let ranCallback = false

      const result = await Task.withAdvisoryLock(lockName, async () => {
        ranCallback = true
        expect(await Task.hasAdvisoryLock(lockName)).toBe(true)

        return "callback-value"
      })

      expect(ranCallback).toBe(true)
      expect(result).toBe("callback-value")
      expect(await Task.hasAdvisoryLock(lockName)).toBe(false)
    })
  })

  it("releases the lock even when the callback throws", async () => {
    await Configuration.current().ensureConnections(async () => {
      const lockName = "velocious-advisory-test-throws"
      const thrown = new Error("boom")

      try {
        await Task.withAdvisoryLock(lockName, async () => {
          expect(await Task.hasAdvisoryLock(lockName)).toBe(true)
          throw thrown
        })
        throw new Error("Expected callback error to propagate")
      } catch (error) {
        expect(error).toBe(thrown)
      }

      expect(await Task.hasAdvisoryLock(lockName)).toBe(false)
    })
  })

  it("runs withAdvisoryLockOrFail when the lock is free", async () => {
    await Configuration.current().ensureConnections(async () => {
      const lockName = "velocious-advisory-test-or-fail-free"
      let ranCallback = false

      const result = await Task.withAdvisoryLockOrFail(lockName, async () => {
        ranCallback = true

        return 42
      })

      expect(ranCallback).toBe(true)
      expect(result).toBe(42)
      expect(await Task.hasAdvisoryLock(lockName)).toBe(false)
    })
  })

  it("throws AdvisoryLockTimeoutError when withAdvisoryLock times out and leaves the lock released for the caller", async () => {
    await Configuration.current().ensureConnections(async () => {
      const lockName = "velocious-advisory-test-timeout"

      // Hold the lock from a sibling driver instance — using
      // `Task.connection().tryAcquireAdvisoryLock` would not work because
      // MySQL/PostgreSQL named locks are re-entrant within a session, so
      // the test's primary connection would be granted the lock again
      // instead of timing out.
      await withSecondConnection(async (blocker) => {
        const held = await blocker.tryAcquireAdvisoryLock(lockName)

        expect(held).toBe(true)

        try {
          await Task.withAdvisoryLock(lockName, async () => {
            throw new Error("Callback should not run when the lock is already held")
          }, {timeoutMs: 100})
          throw new Error("Expected withAdvisoryLock to throw AdvisoryLockTimeoutError")
        } catch (error) {
          if (!(error instanceof AdvisoryLockTimeoutError)) {
            throw error
          }

          expect(error.lockName).toBe(lockName)
        } finally {
          await blocker.releaseAdvisoryLock(lockName)
        }
      })

      expect(await Task.hasAdvisoryLock(lockName)).toBe(false)
    })
  })

  it("throws AdvisoryLockBusyError from withAdvisoryLockOrFail when the lock is already held", async () => {
    await Configuration.current().ensureConnections(async () => {
      const lockName = "velocious-advisory-test-or-fail-busy"

      await withSecondConnection(async (blocker) => {
        const held = await blocker.tryAcquireAdvisoryLock(lockName)

        expect(held).toBe(true)

        try {
          await Task.withAdvisoryLockOrFail(lockName, async () => {
            throw new Error("Callback should not run when the lock is already held")
          })
          throw new Error("Expected withAdvisoryLockOrFail to throw AdvisoryLockBusyError")
        } catch (error) {
          if (!(error instanceof AdvisoryLockBusyError)) {
            throw error
          }

          expect(error.lockName).toBe(lockName)
        } finally {
          await blocker.releaseAdvisoryLock(lockName)
        }
      })

      expect(await Task.hasAdvisoryLock(lockName)).toBe(false)
    })
  })
})
