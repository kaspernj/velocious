// @ts-check

import {GatedLocalJob, gateLocalJob, localBackgroundJobsHarness, resetLocalBackgroundJobClasses} from "../helpers/local-background-jobs-test-harness.js"

describe("Local background jobs dispatcher - concurrency", {tags: ["dummy"], databaseCleaning: {transaction: false, truncate: true}}, () => {
  it("holds a same-key job at its cap while an unrelated key progresses", async () => {
    resetLocalBackgroundJobClasses()
    const first = gateLocalJob("first")
    const second = gateLocalJob("second")
    const unrelated = gateLocalJob("unrelated")
    const {adapter, configuration} = await localBackgroundJobsHarness({jobClasses: [GatedLocalJob], maxConcurrentInlineJobs: 3})
    const cappedOptions = {concurrencyKey: "account:1", maxConcurrency: 1}

    await adapter.enqueue({jobName: GatedLocalJob.jobName(), args: ["first"], options: cappedOptions})
    await first.started
    await adapter.enqueue({jobName: GatedLocalJob.jobName(), args: ["second"], options: cappedOptions})
    await adapter.enqueue({jobName: GatedLocalJob.jobName(), args: ["unrelated"], options: {concurrencyKey: "account:2", maxConcurrency: 1}})
    await unrelated.started
    await Promise.resolve()

    let secondStarted = false
    void second.started.then(() => { secondStarted = true })
    await Promise.resolve()
    expect(secondStarted).toEqual(false)

    first.release()
    await second.started
    second.release()
    unrelated.release()
    await adapter.waitForIdle()
    await configuration.closeBackgroundJobsAdapter()
  })
})
