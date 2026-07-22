// @ts-check

import BackgroundJobsStatusReporter from "../../src/background-jobs/status-reporter.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

describe("BackgroundJobsStatusReporter retry", () => {
  it("retries a failed job status report until it succeeds instead of dropping the terminal status", async () => {
    // Regression: main answers `job-update-error` (its `store.markCompleted` threw a
    // transient DB error — deadlock / connection reset / cold pool right after a deploy
    // restart) so `report()` rejects. This used to be thrown immediately, dropping the
    // completion and stranding the job in `handed_off` forever. It must now retry until
    // the transient failure clears and the terminal status is persisted.
    const reporter = new BackgroundJobsStatusReporter({configuration: dummyConfiguration, host: "127.0.0.1", port: 1})
    let attempts = 0

    reporter.report = async () => {
      attempts += 1

      if (attempts < 3) throw new Error("Job update failed")
    }

    await reporter.reportWithRetry({jobId: "job-1", status: "completed"})

    expect(attempts).toEqual(3)
  })

  it("gives up a persistently failing report once maxDurationMs elapses so it cannot loop unboundedly", async () => {
    const reporter = new BackgroundJobsStatusReporter({configuration: dummyConfiguration, host: "127.0.0.1", port: 1})
    let attempts = 0

    reporter.report = async () => {
      attempts += 1
      throw new Error("connection refused")
    }

    /** @type {Error | undefined} */
    let caught

    try {
      // A tiny positive budget: it retries a couple of times then gives up rather
      // than looping forever against a persistently unreachable main/DB.
      await reporter.reportWithRetry({jobId: "job-2", status: "completed", maxDurationMs: 1})
    } catch (error) {
      caught = /** @type {Error} */ (error)
    }

    expect(caught).toBeInstanceOf(Error)
    expect(attempts >= 1).toEqual(true)
  })
})
