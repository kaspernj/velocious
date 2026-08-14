// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerBase from "../../src/environment-handlers/base.js"
import VelociousJob from "../../src/background-jobs/platform-job.js"
import BackgroundJobsTestAdapter from "../helpers/background-jobs-test-adapter.js"
import {describe, expect, it} from "../../src/testing/test.js"

class InlineModeJob extends VelociousJob {
  static databaseIdentifiers = []
  static performances = []

  async perform(value) {
    this.constructor.performances.push(value)
  }
}

class ReschedulingInlineModeJob extends VelociousJob {
  static databaseIdentifiers = []

  async perform() {
    this.rescheduleIn(1)
  }
}

/** @returns {Configuration} - Inline-mode configuration. */
function inlineConfiguration() {
  return new Configuration({
    backgroundJobs: {mode: "inline"},
    directory: process.cwd(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerBase(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]}
  })
}

describe("Background jobs runtime mode", () => {
  it("performs immediately without resolving a background adapter", async () => {
    const previousConfiguration = Configuration.current()
    const configuration = inlineConfiguration()
    InlineModeJob.performances = []
    configuration.setCurrent()

    try {
      const jobId = await InlineModeJob.performLater("inline-value")

      expect(typeof jobId).toEqual("string")
      expect(InlineModeJob.performances).toEqual(["inline-value"])
    } finally {
      previousConfiguration.setCurrent()
    }
  })

  it("rejects durable options and stable scheduling in inline mode", async () => {
    const previousConfiguration = Configuration.current()
    const configuration = inlineConfiguration()
    configuration.setCurrent()

    try {
      await expect(async () => await InlineModeJob.performLaterWithOptions({args: [], options: {scheduledAtMs: 1}})).toThrow(/scheduledAtMs.*inline mode/)
      await expect(async () => await InlineModeJob.performLaterWithOptions({args: [], options: {executionMode: "inline"}})).toThrow(/executionMode.*inline mode/)
      await expect(async () => await InlineModeJob.replaceScheduled({scheduleKey: "inline", args: []})).toThrow(/replaceScheduled.*inline mode/)
      await expect(async () => await InlineModeJob.cancelScheduled("inline")).toThrow(/cancelScheduled.*inline mode/)
      await expect(async () => await ReschedulingInlineModeJob.performLater()).toThrow(/rescheduleIn.*inline mode/)
    } finally {
      previousConfiguration.setCurrent()
    }
  })

  it("delegates background mode to a configured adapter", async () => {
    const previousConfiguration = Configuration.current()
    const adapter = new BackgroundJobsTestAdapter()
    const configuration = new Configuration({
      backgroundJobs: {adapter, mode: "background"},
      directory: process.cwd(),
      environment: "test",
      environmentHandler: new EnvironmentHandlerBase(),
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]}
    })
    configuration.setCurrent()

    try {
      expect(await InlineModeJob.performLaterWithOptions({
        args: ["background-value"],
        options: {executionMode: "forked"}
      })).toEqual("adapter-job-id")
      expect(adapter.calls).toMatchObject([
        {method: "ensureReady"},
        {args: {jobName: "InlineModeJob", args: ["background-value"], options: {executionMode: "forked"}}, method: "enqueue"}
      ])
    } finally {
      previousConfiguration.setCurrent()
    }
  })
})
