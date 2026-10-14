// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import {DEFAULT_SCHEDULED_ENQUEUE_TIMEOUT_MS} from "../../src/background-jobs/scheduled-enqueue-bound.js"
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

describe("Background jobs scheduled enqueue timeout configuration", () => {
  it("defaults to a finite bound", () => {
    const config = buildConfiguration().getBackgroundJobsConfig()

    expect(config.scheduledEnqueueTimeoutMs).toEqual(DEFAULT_SCHEDULED_ENQUEUE_TIMEOUT_MS)
  })

  it("honours an explicit positive bound", () => {
    const config = buildConfiguration({scheduledEnqueueTimeoutMs: 45000}).getBackgroundJobsConfig()

    expect(config.scheduledEnqueueTimeoutMs).toEqual(45000)
  })

  it("honours an explicit null opt-out", () => {
    const config = buildConfiguration({scheduledEnqueueTimeoutMs: null}).getBackgroundJobsConfig()

    expect(config.scheduledEnqueueTimeoutMs).toBeNull()
  })

  it("falls back to the bound for a non-positive number instead of disabling it by accident", () => {
    const config = buildConfiguration({scheduledEnqueueTimeoutMs: 0}).getBackgroundJobsConfig()

    expect(config.scheduledEnqueueTimeoutMs).toEqual(DEFAULT_SCHEDULED_ENQUEUE_TIMEOUT_MS)
  })
})
