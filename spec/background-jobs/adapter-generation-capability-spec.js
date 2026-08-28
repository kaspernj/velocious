// @ts-check

import BackgroundJobsMain from "../../src/background-jobs/main.js"
import SqlBackgroundJobsAdapter from "../../src/background-jobs/sql-adapter.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import BackgroundJobsTestAdapter from "../helpers/background-jobs-test-adapter.js"
import { describe, expect, it } from "../../src/testing/test.js"

class LegacyStartableAdapter extends BackgroundJobsTestAdapter {
  async reconcileQueueConcurrency() {}
  async nextAvailableJob() { return null }
  async nextScheduledJob() { return null }
  async markOrphanedJobs() { return [] }
}

describe("Background jobs generation adapter capability", () => {
  it("rejects an unsupported adapter before listening in generation mode", async () => {
    dummyConfiguration.setBackgroundJobsConfig({generationId: undefined, initialGenerationState: undefined, lifecycleSocketPath: undefined})
    const main = new BackgroundJobsMain({
      configuration: dummyConfiguration,
      generationId: "release-unsupported",
      host: "127.0.0.1",
      initialGenerationState: "candidate",
      port: 0
    })
    main.store = new BackgroundJobsTestAdapter()

    await expect(async () => await main.start()).toThrow(/does not support release-scoped generations/)
    expect(main.server).toEqual(undefined)
  })

  it("declares the built-in SQL capability and leaves legacy custom adapters compatible", async () => {
    dummyConfiguration.setBackgroundJobsConfig({generationId: undefined, initialGenerationState: undefined, lifecycleSocketPath: undefined})
    const sqlAdapter = new SqlBackgroundJobsAdapter({configuration: dummyConfiguration})
    const legacyAdapter = new LegacyStartableAdapter()
    const main = new BackgroundJobsMain({
      configuration: dummyConfiguration,
      host: "127.0.0.1",
      port: 0
    })
    main.store = legacyAdapter

    expect(sqlAdapter.supportsReleaseScopedGenerations()).toEqual(true)
    expect(legacyAdapter.supportsReleaseScopedGenerations()).toEqual(false)
    try {
      await main.start()
      expect(main.server?.listening).toEqual(true)
    } finally {
      await main.stop()
    }
  })
})
