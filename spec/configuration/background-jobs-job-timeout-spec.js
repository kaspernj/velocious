// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import {describe, expect, it} from "../../src/testing/test.js"

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
 * @param {string | undefined} value - Env value to set (undefined deletes it).
 * @param {() => void} body - Assertions to run with the env applied.
 * @returns {void}
 */
function withEnvJobTimeout(value, body) {
  const previous = process.env.VELOCIOUS_BACKGROUND_JOBS_JOB_TIMEOUT_MS

  if (value === undefined) delete process.env.VELOCIOUS_BACKGROUND_JOBS_JOB_TIMEOUT_MS
  else process.env.VELOCIOUS_BACKGROUND_JOBS_JOB_TIMEOUT_MS = value

  try {
    body()
  } finally {
    if (previous === undefined) delete process.env.VELOCIOUS_BACKGROUND_JOBS_JOB_TIMEOUT_MS
    else process.env.VELOCIOUS_BACKGROUND_JOBS_JOB_TIMEOUT_MS = previous
  }
}

describe("Configuration.getBackgroundJobsConfig jobTimeoutMs", () => {
  it("falls through to the env var only when config omits jobTimeoutMs", () => {
    withEnvJobTimeout("90000", () => {
      expect(buildConfiguration({}).getBackgroundJobsConfig().jobTimeoutMs).toEqual(90000)
    })
  })

  it("honors an explicit null config over the env var", () => {
    withEnvJobTimeout("90000", () => {
      expect(buildConfiguration({jobTimeoutMs: null}).getBackgroundJobsConfig().jobTimeoutMs).toEqual(null)
    })
  })

  it("honors an explicit 0 config over the env var", () => {
    withEnvJobTimeout("90000", () => {
      expect(buildConfiguration({jobTimeoutMs: 0}).getBackgroundJobsConfig().jobTimeoutMs).toEqual(null)
    })
  })

  it("uses an explicit positive config value", () => {
    withEnvJobTimeout(undefined, () => {
      expect(buildConfiguration({jobTimeoutMs: 12345}).getBackgroundJobsConfig().jobTimeoutMs).toEqual(12345)
    })
  })
})
