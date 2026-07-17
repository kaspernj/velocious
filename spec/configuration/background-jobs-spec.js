// @ts-check

import Configuration from "../../src/configuration.js"
import { describe, expect, it } from "../../src/testing/test.js"

describe("Background jobs configuration", () => {
  it("requires positive integer pooled runner counts and job limits", () => {
    for (const invalidValue of [1.5, Infinity, 0, -1]) {
      const configuration = new Configuration({
        backgroundJobs: {pooledRunnerCount: invalidValue, pooledRunnerMaxJobs: invalidValue}
      })
      const config = configuration.getBackgroundJobsConfig()

      expect(config.pooledRunnerCount).toEqual(4)
      expect(config.pooledRunnerMaxJobs).toEqual(100)
    }

    const validConfig = new Configuration({
      backgroundJobs: {pooledRunnerCount: 2, pooledRunnerMaxJobs: 25}
    }).getBackgroundJobsConfig()
    expect(validConfig.pooledRunnerCount).toEqual(2)
    expect(validConfig.pooledRunnerMaxJobs).toEqual(25)
  })

  it("requires finite positive pooled runner resource limits", () => {
    for (const invalidValue of [Infinity, 0, -1]) {
      const configuration = new Configuration({
        backgroundJobs: {pooledRunnerMaxRssBytes: invalidValue, pooledRunnerMaxLifetimeMs: invalidValue}
      })
      const config = configuration.getBackgroundJobsConfig()

      expect(config.pooledRunnerMaxRssBytes).toEqual(512 * 1024 * 1024)
      expect(config.pooledRunnerMaxLifetimeMs).toEqual(60 * 60 * 1000)
    }

    const validConfig = new Configuration({
      backgroundJobs: {pooledRunnerMaxRssBytes: 1.5, pooledRunnerMaxLifetimeMs: 2.5}
    }).getBackgroundJobsConfig()
    expect(validConfig.pooledRunnerMaxRssBytes).toEqual(1.5)
    expect(validConfig.pooledRunnerMaxLifetimeMs).toEqual(2.5)
  })
})
