// @ts-check

import VelociousJob from "../../src/background-jobs/job.js"
import PlatformVelociousJob from "../../src/background-jobs/platform-job.js"

/** Job class declaring its own wall-clock bound. */
class BoundedJob extends PlatformVelociousJob {
  static timeoutMs = 90_000
}

/** Job class with no declared bound, so the worker-level value applies. */
class UnboundedJob extends PlatformVelociousJob {}

/** Job class that explicitly disables the bound for its type. */
class DisabledTimeoutJob extends PlatformVelociousJob {
  static timeoutMs = 0
}

describe("Background jobs - per-job-class timeout", () => {
  it("folds a job class's static timeoutMs into the resolved enqueue options", () => {
    const options = BoundedJob._withJobContext({jobArgs: [], jobOptions: undefined})

    expect(options.timeoutMs).toEqual(90_000)
  })

  it("lets an explicit per-enqueue timeoutMs win over the class value", () => {
    const options = BoundedJob._withJobContext({jobArgs: [], jobOptions: {timeoutMs: 5_000}})

    expect(options.timeoutMs).toEqual(5_000)
  })

  it("leaves the option absent when the class declares no timeout", () => {
    const options = UnboundedJob._withJobContext({jobArgs: [], jobOptions: undefined})

    expect("timeoutMs" in options).toEqual(false)
  })

  it("carries a class-level opt-out through instead of dropping it", () => {
    const options = DisabledTimeoutJob._withJobContext({jobArgs: [], jobOptions: undefined})

    expect(options.timeoutMs).toEqual(0)
  })

  it("exposes an undefined default on the framework base class", () => {
    expect(VelociousJob.timeoutMs).toEqual(undefined)
  })
})
