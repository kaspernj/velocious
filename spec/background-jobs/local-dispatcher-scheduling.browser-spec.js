// @ts-check

import {RecordingLocalJob, ReschedulingLocalJob, RetryingLocalJob, localBackgroundJobsHarness, resetLocalBackgroundJobClasses} from "../helpers/local-background-jobs-test-harness.js"

describe("Local background jobs dispatcher - scheduling", {tags: ["dummy"], databaseCleaning: {transaction: false, truncate: true}}, () => {
  it("arms exact scheduled work and preserves retry, exhaustion, and reschedule semantics", async () => {
    resetLocalBackgroundJobClasses()
    const {adapter, clock, configuration} = await localBackgroundJobsHarness({jobClasses: [RecordingLocalJob, RetryingLocalJob, ReschedulingLocalJob]})
    const scheduledId = await adapter.enqueue({jobName: RecordingLocalJob.jobName(), args: ["scheduled"], options: {scheduledAtMs: clock.now() + 1_000}})

    await adapter.waitForIdle()
    expect(RecordingLocalJob.performances).toEqual([])

    await clock.advance(999)
    await adapter.waitForIdle()
    expect(RecordingLocalJob.performances).toEqual([])

    await clock.advance(1)
    await adapter.waitForIdle()
    expect((await adapter.getJob(scheduledId))?.status).toEqual("completed")

    const retryId = await adapter.enqueue({jobName: RetryingLocalJob.jobName(), args: ["retry", 1], options: {maxRetries: 1}})

    await adapter.waitForIdle()
    expect((await adapter.getJob(retryId))?.scheduledAtMs).toEqual(clock.now() + 10_000)
    await clock.advance(10_000)
    await adapter.waitForIdle()
    expect((await adapter.getJob(retryId))?.status).toEqual("completed")

    const exhaustedId = await adapter.enqueue({jobName: RetryingLocalJob.jobName(), args: ["exhausted", 2], options: {maxRetries: 1}})

    await adapter.waitForIdle()
    await clock.advance(10_000)
    await adapter.waitForIdle()
    expect((await adapter.getJob(exhaustedId))?.status).toEqual("failed")
    expect((await adapter.getJob(exhaustedId))?.attempts).toEqual(2)

    const rescheduledId = await adapter.enqueue({jobName: ReschedulingLocalJob.jobName(), args: [], options: {maxRetries: 0}})

    await adapter.waitForIdle()
    expect((await adapter.getJob(rescheduledId))?.attempts).toEqual(0)
    expect((await adapter.getJob(rescheduledId))?.scheduledAtMs).toEqual(clock.now() + 500)
    await clock.advance(500)
    await adapter.waitForIdle()
    expect((await adapter.getJob(rescheduledId))?.status).toEqual("completed")
    expect(ReschedulingLocalJob.attempts).toEqual(2)
    await configuration.closeBackgroundJobsAdapter()
  })
})
