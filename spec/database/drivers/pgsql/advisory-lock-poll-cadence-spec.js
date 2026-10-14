// @ts-check

import PgsqlDriver from "../../../../src/database/drivers/pgsql/index.js"
import {DEFAULT_ADVISORY_LOCK_ACQUIRE_TIMEOUT_MS} from "../../../../src/database/advisory-lock-bound.js"
import {describe, expect, it} from "../../../../src/testing/test.js"

describe("Pgsql advisory lock poll cadence", () => {
  it("keeps the historical 50ms cadence for short explicit bounds", () => {
    expect(PgsqlDriver.advisoryLockPollIntervalMs(5000)).toEqual(50)
    expect(PgsqlDriver.advisoryLockPollIntervalMs(1000)).toEqual(50)
    expect(PgsqlDriver.advisoryLockPollIntervalMs(100)).toEqual(50)
  })

  it("coarsens the cadence for the framework default bound instead of probing tens of thousands of times", () => {
    const intervalMs = PgsqlDriver.advisoryLockPollIntervalMs(DEFAULT_ADVISORY_LOCK_ACQUIRE_TIMEOUT_MS)

    expect(intervalMs).toEqual(2000)
    // A wedged holder must not turn one contended lock into a query storm.
    expect(DEFAULT_ADVISORY_LOCK_ACQUIRE_TIMEOUT_MS / intervalMs).toBeLessThan(1000)
  })
})
