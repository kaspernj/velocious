// @ts-check

import {
  normalizeBackgroundJobConcurrency,
  normalizeBackgroundJobExecutionMode,
  normalizeBackgroundJobMaxRetries,
  normalizeBackgroundJobQueue,
  normalizeBackgroundJobScheduledAtMs,
  retryDelayMs
} from "../../src/background-jobs/job-semantics.js"
import LocalBackgroundJobRegistry from "../../src/background-jobs/local-job-registry.js"
import VelociousJob from "../../src/background-jobs/platform-job.js"
import {describe, expect, it} from "../../src/testing/test.js"

class RegisteredPortableJob extends VelociousJob {}
class DuplicatePortableJob extends VelociousJob {
  static jobName() { return RegisteredPortableJob.jobName() }
}

describe("Background jobs - portable job semantics", () => {
  it("normalizes the shared queue, concurrency, schedule, execution, and retry contract", () => {
    expect(normalizeBackgroundJobQueue()).toEqual("default")
    expect(normalizeBackgroundJobQueue({queue: " uploads "})).toEqual("uploads")
    expect(normalizeBackgroundJobConcurrency({options: {}, queue: "uploads", queues: {uploads: {maxConcurrent: 2}}})).toEqual({concurrencyKey: "queue:uploads", maxConcurrency: 2, queueDerived: true})
    expect(normalizeBackgroundJobConcurrency({options: {concurrencyKey: "account:1", maxConcurrency: 1}, queue: "uploads", queues: {uploads: {maxConcurrent: 2}}})).toEqual({concurrencyKey: "account:1", maxConcurrency: 1, queueDerived: false})
    expect(normalizeBackgroundJobExecutionMode(undefined, "pooled")).toEqual("pooled")
    expect(normalizeBackgroundJobExecutionMode({executionMode: "inline"}, "inline")).toEqual("inline")
    expect(normalizeBackgroundJobMaxRetries(undefined)).toEqual(10)
    expect(normalizeBackgroundJobScheduledAtMs(undefined, 123)).toEqual(123)
    expect(retryDelayMs(1)).toEqual(10_000)
    expect(retryDelayMs(5)).toEqual(2 * 60 * 60 * 1000)
  })

  it("rejects invalid portable options at their shared boundary", async () => {
    await expect(async () => normalizeBackgroundJobConcurrency({options: {concurrencyKey: "queue:reserved", maxConcurrency: 1}, queue: "default", queues: {}})).toThrow(/reserved/)
    await expect(async () => normalizeBackgroundJobExecutionMode({executionMode: "pooled"}, "inline", ["inline"])).toThrow(/not supported by the local background-jobs adapter/)
    await expect(async () => normalizeBackgroundJobScheduledAtMs(-1, 123)).toThrow(/scheduledAtMs/)
  })

  it("validates a static registry and rejects absent or duplicate persisted names", async () => {
    const registry = new LocalBackgroundJobRegistry({jobClasses: [RegisteredPortableJob]})

    expect(registry.resolve(RegisteredPortableJob.jobName())).toEqual(RegisteredPortableJob)
    await expect(async () => registry.resolve("MissingPortableJob")).toThrow(/not registered/)
    await expect(async () => new LocalBackgroundJobRegistry({jobClasses: [RegisteredPortableJob, DuplicatePortableJob]}).ensureReady()).toThrow(/Duplicate/)
  })
})
