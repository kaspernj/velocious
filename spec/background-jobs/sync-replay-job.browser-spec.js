// @ts-check

import LocalBackgroundJobsAdapter from "../../src/background-jobs/local-adapter.js"
import Configuration from "../../src/configuration.js"
import SyncReplayJob from "../../src/background-jobs/sync-replay-job.js"
import {RecordingLocalJob, resetLocalBackgroundJobClasses} from "../helpers/local-background-jobs-test-harness.js"
import {setCurrentSyncClient} from "../../src/sync/sync-client-registry.js"

describe("Sync replay job", {tags: ["dummy", "browser-only"], databaseCleaning: {transaction: false, truncate: true}}, () => {
  /**
   * Installs the local background-jobs adapter with the replay job registered.
   * @returns {Promise<{adapter: LocalBackgroundJobsAdapter, configuration: Configuration}>} - Ready adapter.
   */
  async function setUpAdapter() {
    const configuration = Configuration.current()

    resetLocalBackgroundJobClasses()
    await configuration.closeBackgroundJobsAdapter()
    configuration.setBackgroundJobsConfig({adapter: undefined, jobClasses: [SyncReplayJob, RecordingLocalJob], mode: "background", queues: {}})
    configuration.setCurrent()

    const adapter = await configuration.acquireReadyBackgroundJobsAdapter()

    if (!(adapter instanceof LocalBackgroundJobsAdapter)) throw new Error("Expected local background-jobs adapter")

    return {adapter, configuration}
  }

  it("drains the pending sync queue through the registered client", async () => {
    const {adapter, configuration} = await setUpAdapter()
    let replayCount = 0

    setCurrentSyncClient({replayPending: async () => { replayCount += 1 }})

    try {
      const jobId = await SyncReplayJob.enqueue()

      await adapter.waitForIdle()

      expect(replayCount).toEqual(1)
      expect((await adapter.getJob(jobId))?.status).toEqual("completed")
    } finally {
      setCurrentSyncClient(null)
      await configuration.closeBackgroundJobsAdapter()
    }
  })

  it("collapses overlapping enqueues into one replay", async () => {
    const {adapter, configuration} = await setUpAdapter()
    let replayCount = 0

    setCurrentSyncClient({replayPending: async () => { replayCount += 1 }})

    try {
      await SyncReplayJob.enqueue()
      await SyncReplayJob.enqueue()

      await adapter.waitForIdle()

      expect(replayCount).toEqual(1)
    } finally {
      setCurrentSyncClient(null)
      await configuration.closeBackgroundJobsAdapter()
    }
  })

  it("is a no-op when no sync client is registered", async () => {
    const {adapter, configuration} = await setUpAdapter()

    setCurrentSyncClient(null)

    try {
      const jobId = await SyncReplayJob.enqueue()

      await adapter.waitForIdle()

      expect((await adapter.getJob(jobId))?.status).toEqual("completed")
    } finally {
      await configuration.closeBackgroundJobsAdapter()
    }
  })
})
