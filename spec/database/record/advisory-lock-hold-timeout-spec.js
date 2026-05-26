// @ts-check

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
})
