// @ts-check

import BackgroundJobsMain from "../../src/background-jobs/main.js"
import BackgroundJobsStore from "../../src/background-jobs/store.js"
import JsonSocket from "../../src/background-jobs/json-socket.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

class FailingRescheduleStore extends BackgroundJobsStore {
  /** @returns {Promise<boolean>} - Always rejects like a persistence failure. */
  async markRescheduled() {
    throw new Error("Reschedule persistence failed")
  }
}

class MainWithFailingRescheduleStore extends BackgroundJobsMain {
  /** @param {ConstructorParameters<typeof BackgroundJobsMain>[0]} args - Main options. */
  constructor(args) {
    super(args)
    this.store = new FailingRescheduleStore({configuration: args.configuration})
  }
}

describe("Background jobs - main reschedule errors", () => {
  it("reports an unexpected persistence error while retaining the retry response", async () => {
    const main = new MainWithFailingRescheduleStore({configuration: dummyConfiguration, host: "127.0.0.1", port: 0})
    const sent = []
    const frameworkErrors = []
    const allErrors = []
    const errorEvents = dummyConfiguration.getErrorEvents()
    const onFrameworkError = (payload) => frameworkErrors.push(payload)
    const onAllError = (payload) => allErrors.push(payload)
    errorEvents.on("framework-error", onFrameworkError)
    errorEvents.on("all-error", onAllError)

    try {
      await main._handleJobReschedule({
        jsonSocket: /** @type {JsonSocket} */ (/** @type {ReturnType<typeof JSON.parse>} */ ({send: (message) => sent.push(message)})),
        message: {type: "job-reschedule", jobId: "job-1", delayMs: 1_000}
      })
    } finally {
      errorEvents.off("framework-error", onFrameworkError)
      errorEvents.off("all-error", onAllError)
    }

    expect(sent).toEqual([{type: "job-update-error", jobId: "job-1", error: "Failed to update job"}])
    expect(frameworkErrors).toMatchObject([{context: {jobId: "job-1", stage: "background-job-reschedule"}, error: {message: "Reschedule persistence failed"}}])
    expect(allErrors).toMatchObject([{context: {jobId: "job-1", stage: "background-job-reschedule"}, error: {message: "Reschedule persistence failed"}, errorType: "framework-error"}])
  })
})
