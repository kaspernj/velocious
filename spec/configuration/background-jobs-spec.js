// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import {describe, expect, it} from "../../src/testing/test.js"

const pooledRunnerEnv = {
  VELOCIOUS_BACKGROUND_JOBS_POOLED_RUNNER_COUNT: "8",
  VELOCIOUS_BACKGROUND_JOBS_POOLED_RUNNER_MAX_JOBS: "200",
  VELOCIOUS_BACKGROUND_JOBS_POOLED_RUNNER_MAX_LIFETIME_MS: "7200000",
  VELOCIOUS_BACKGROUND_JOBS_POOLED_RUNNER_MAX_RSS_BYTES: "1073741824"
}

/**
 * @param {import("../../src/configuration-types.js").BackgroundJobsConfiguration} [backgroundJobs] - Background jobs config.
 * @returns {Configuration} - Configuration.
 */
function buildConfiguration(backgroundJobs) {
  return new Configuration({
    backgroundJobs,
    directory: process.cwd(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]}
  })
}

/**
 * @param {() => void} body - Assertions to run with pooled-runner env values applied.
 * @returns {void}
 */
function withPooledRunnerEnv(body) {
  const previous = Object.fromEntries(Object.keys(pooledRunnerEnv).map((key) => [key, process.env[key]]))

  Object.assign(process.env, pooledRunnerEnv)

  try {
    body()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

describe("Background jobs configuration", () => {
  it("requires positive integer pooled runner counts and job limits", () => {
    withPooledRunnerEnv(() => {
      for (const invalidValue of [1.5, Infinity, 0, -1]) {
        const config = buildConfiguration({
          pooledRunnerCount: invalidValue,
          pooledRunnerMaxJobs: invalidValue
        }).getBackgroundJobsConfig()

        expect(config.pooledRunnerCount).toEqual(4)
        expect(config.pooledRunnerMaxJobs).toEqual(100)
      }

      const validConfig = buildConfiguration({pooledRunnerCount: 2, pooledRunnerMaxJobs: 25}).getBackgroundJobsConfig()
      expect(validConfig.pooledRunnerCount).toEqual(2)
      expect(validConfig.pooledRunnerMaxJobs).toEqual(25)

      const envConfig = buildConfiguration().getBackgroundJobsConfig()
      expect(envConfig.pooledRunnerCount).toEqual(8)
      expect(envConfig.pooledRunnerMaxJobs).toEqual(200)
    })
  })

  it("requires finite positive pooled runner resource limits", () => {
    withPooledRunnerEnv(() => {
      for (const invalidValue of [Infinity, 0, -1]) {
        const config = buildConfiguration({
          pooledRunnerMaxRssBytes: invalidValue,
          pooledRunnerMaxLifetimeMs: invalidValue
        }).getBackgroundJobsConfig()

        expect(config.pooledRunnerMaxRssBytes).toEqual(512 * 1024 * 1024)
        expect(config.pooledRunnerMaxLifetimeMs).toEqual(60 * 60 * 1000)
      }

      const validConfig = buildConfiguration({pooledRunnerMaxRssBytes: 1.5, pooledRunnerMaxLifetimeMs: 2.5}).getBackgroundJobsConfig()
      expect(validConfig.pooledRunnerMaxRssBytes).toEqual(1.5)
      expect(validConfig.pooledRunnerMaxLifetimeMs).toEqual(2.5)

      const envConfig = buildConfiguration().getBackgroundJobsConfig()
      expect(envConfig.pooledRunnerMaxRssBytes).toEqual(1073741824)
      expect(envConfig.pooledRunnerMaxLifetimeMs).toEqual(7200000)
    })
  })
})
