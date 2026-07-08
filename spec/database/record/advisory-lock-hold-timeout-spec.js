// @ts-check

import timeout from "awaitery/build/timeout.js"

import VelociousDatabaseRecord, {AdvisoryLockHoldTimeoutError} from "../../../src/database/record/index.js"

describe("Record - advisory lock hold timeout", () => {
  it("returns the callback value when it settles within the hold timeout", async () => {
    const result = await VelociousDatabaseRecord.runWithAdvisoryLockHoldTimeout("lock-name", async () => "done", 1000)

    expect(result).toEqual("done")
  })

  it("does not apply a timeout when holdTimeoutMs is falsy", async () => {
    const result = await VelociousDatabaseRecord.runWithAdvisoryLockHoldTimeout("lock-name", async () => "ok", 0)

    expect(result).toEqual("ok")
  })

  it("rejects with AdvisoryLockHoldTimeoutError when the callback outlives the hold timeout", async () => {
    const neverSettles = () => new Promise(() => {})
    let thrown

    try {
      await VelociousDatabaseRecord.runWithAdvisoryLockHoldTimeout("lock-name", neverSettles, 20)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(AdvisoryLockHoldTimeoutError)
  })

  it("does not wait for a blocked release query after the hold timeout fires", async () => {
    const neverSettles = () => new Promise(() => {})
    let timeoutCleanupLockName
    const lockConnection = {
      async releaseAdvisoryLock() {
        await neverSettles()

        return true
      },

      async releaseAdvisoryLockAfterHoldTimeout(name) {
        timeoutCleanupLockName = name
      },

      async tryAcquireAdvisoryLock() {
        return true
      }
    }
    class BlockingReleaseRecord extends VelociousDatabaseRecord {
      static async ensureInitialized() {}

      static connection() {
        return /** @type {import("../../../src/database/drivers/base.js").default} */ (lockConnection)
      }
    }
    let thrown

    try {
      await timeout({timeout: 1000}, async () => {
        await BlockingReleaseRecord.withAdvisoryLockOrFail("blocked-release-lock", neverSettles, {holdTimeoutMs: 50})
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(AdvisoryLockHoldTimeoutError)
    expect(timeoutCleanupLockName).toBe("blocked-release-lock")
  })
})
