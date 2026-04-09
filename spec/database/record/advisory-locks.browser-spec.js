// @ts-check

import Configuration from "../../../src/configuration.js"
import Task from "../../dummy/src/models/task.js"
import {AdvisoryLockBusyError, AdvisoryLockTimeoutError} from "../../../src/database/record/index.js"

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
      const connection = Task.connection()

      const held = await connection.tryAcquireAdvisoryLock(lockName)

      expect(held).toBe(true)

      try {
        // Use a cross-driver friendly timeout. MySQL's GET_LOCK accepts a
        // timeout in seconds so this gets rounded up to 1; the point is to
        // exercise the timeout branch without stalling the suite.
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
        await connection.releaseAdvisoryLock(lockName)
      }

      expect(await Task.hasAdvisoryLock(lockName)).toBe(false)
    })
  })

  it("throws AdvisoryLockBusyError from withAdvisoryLockOrFail when the lock is already held", async () => {
    await Configuration.current().ensureConnections(async () => {
      const lockName = "velocious-advisory-test-or-fail-busy"
      const connection = Task.connection()

      const held = await connection.tryAcquireAdvisoryLock(lockName)

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
        await connection.releaseAdvisoryLock(lockName)
      }

      expect(await Task.hasAdvisoryLock(lockName)).toBe(false)
    })
  })
})
